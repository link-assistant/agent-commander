use agent_commander::tools::{agent, claude, codex, gemini, opencode, qwen};
use agent_commander::{build_normalized_result_metadata, BuildMetadataOptions};
use serde_json::Value;
fn fixtures() -> Value {
    serde_json::from_str(include_str!("fixtures/hive-mind-parity.json")).unwrap()
}
#[test]
fn native_metadata_matches_hive_mind_contract() {
    for case in fixtures()["metadata"].as_array().unwrap() {
        let events = case["events"].as_array().unwrap();
        let output = events
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let actual = serde_json::to_value(build_normalized_result_metadata(BuildMetadataOptions {
            tool: case["tool"].as_str().unwrap(),
            exit_code: 0,
            plain_output: &output,
            parsed_output: Some(events),
            session_id: None,
            usage: None,
        }))
        .unwrap();
        for (key, expected) in case["expected"].as_object().unwrap() {
            assert_eq!(&actual[key], expected, "{}: {key}", case["name"]);
        }
        if let Some(id) = case.get("subAgentId") {
            assert_eq!(&actual["subAgentCalls"][0]["id"], id);
        }
    }
}
#[test]
fn bundled_models_match_hive_mind() {
    let catalog: Value = serde_json::from_str(include_str!("fixtures/model-catalog.json")).unwrap();
    for (tool, models) in catalog["models"].as_object().unwrap() {
        let mapper: fn(&str) -> String = match tool.as_str() {
            "claude" => claude::map_model_to_id,
            "codex" => codex::map_model_to_id,
            "opencode" => opencode::map_model_to_id,
            "agent" => agent::map_model_to_id,
            "qwen" => qwen::map_model_to_id,
            _ => gemini::map_model_to_id,
        };
        for (alias, id) in models.as_object().unwrap() {
            assert_eq!(mapper(alias), id.as_str().unwrap(), "{tool}/{alias}");
        }
    }
}
#[test]
fn native_usage_matches_hive_mind_contract() {
    for case in fixtures()["usage"].as_array().unwrap() {
        let output = case["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        let actual = match case["tool"].as_str().unwrap() {
            "claude" => serde_json::to_value(claude::extract_usage(&output)),
            "codex" => serde_json::to_value(codex::extract_usage(&output)),
            "agent" => serde_json::to_value(agent::extract_usage(&output)),
            "opencode" => serde_json::to_value(opencode::extract_usage(&output)),
            "qwen" => serde_json::to_value(qwen::extract_usage(&output)),
            _ => serde_json::to_value(gemini::extract_usage(&output)),
        }
        .unwrap();
        for (key, expected) in case["usage"].as_object().unwrap() {
            assert_eq!(&actual[key], expected, "{}: {key}", case["name"]);
        }
    }
}
#[tokio::test]
#[cfg(unix)]
async fn drains_both_pipes_without_deadlock() {
    // Finite 128 KiB of stderr; the timeout bounds the regression probe.
    let command = "head -c 131072 /dev/zero | tr '\\0' x >&2; printf done";
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        agent_commander::executor::execute_command(command, false, false),
    )
    .await
    .expect("stderr blocked stdout draining")
    .unwrap();
    assert_eq!(result.stdout.trim(), "done");
    assert_eq!(result.stderr.trim().len(), 131_072);
}
#[tokio::test]
#[cfg(unix)]
async fn all_controllers_keep_stderr_out_of_metadata() {
    use agent_commander::{Agent, AgentOptions, AgentStartOptions, AgentStopOptions};
    use std::os::unix::fs::PermissionsExt;
    for case in fixtures()["usage"].as_array().unwrap() {
        let directory = tempfile::tempdir().unwrap();
        let executable = directory.path().join("fixture-tool");
        let output = case["events"]
            .as_array()
            .unwrap()
            .iter()
            .map(Value::to_string)
            .collect::<Vec<_>>()
            .join("\n");
        std::fs::write(&executable, format!("#!/bin/bash\ncat >/dev/null\nprintf '%s\\n' '{}'\nprintf '%s\\n' '{{\"type\":\"error\",\"session_id\":\"ghost\",\"usage\":{{\"input_tokens\":9999}}}}' >&2\n", output.replace('\'', "'\\''"))).unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        let mut controller = Agent::new(AgentOptions {
            tool: case["tool"].as_str().unwrap().into(),
            working_directory: directory.path().to_str().unwrap().into(),
            prompt: Some("Exact prompt".into()),
            json: true,
            executable: Some(executable.to_str().unwrap().into()),
            ..Default::default()
        })
        .unwrap();
        controller
            .start(AgentStartOptions {
                attached: false,
                ..Default::default()
            })
            .await
            .unwrap();
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            controller.stop(AgentStopOptions::default()),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(
            result.metadata.success,
            "{}: {:?}",
            case["tool"], result.metadata
        );
        assert_ne!(result.session_id.as_deref(), Some("ghost"));
        for (key, expected) in case["usage"].as_object().unwrap() {
            assert_eq!(
                &result.usage.as_ref().unwrap()[key],
                expected,
                "{}: {key}",
                case["name"]
            );
        }
    }
}
#[tokio::test]
#[cfg(unix)]
async fn caller_can_cancel_controller() {
    use agent_commander::{Agent, AgentOptions, AgentStartOptions};
    let mut controller = Agent::new(AgentOptions {
        tool: "sleep 30".into(),
        working_directory: "/tmp".into(),
        ..Default::default()
    })
    .unwrap();
    controller
        .start(AgentStartOptions {
            attached: false,
            ..Default::default()
        })
        .await
        .unwrap();
    let result = tokio::time::timeout(std::time::Duration::from_secs(5), controller.cancel())
        .await
        .unwrap()
        .unwrap();
    assert_ne!(result.exit_code, 0);
    assert!(!result.metadata.success);
}
#[tokio::test]
async fn unregistering_signal_handler_does_not_run_cleanup() {
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Arc,
    };
    let called = Arc::new(AtomicBool::new(false));
    let observed = called.clone();
    let unregister = agent_commander::executor::setup_signal_handler(move || {
        observed.store(true, Ordering::SeqCst);
    });
    unregister();
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    assert!(!called.load(Ordering::SeqCst));
}
#[test]
fn native_gemini_resume_and_claude_print_mode() {
    let args = gemini::build_args(&gemini::GeminiBuildOptions {
        resume: Some("old-session".into()),
        ..Default::default()
    });
    assert!(args
        .windows(2)
        .any(|pair| pair == ["--resume", "old-session"]));
    let args = claude::build_args(&claude::ClaudeBuildOptions {
        prompt: Some("Hello".into()),
        json: true,
        ..Default::default()
    });
    assert!(args.windows(2).any(|pair| pair == ["-p", "Hello"]));
    assert!(args.iter().any(|arg| arg == "--verbose"));
    assert!(!args.iter().any(|arg| arg == "--prompt"));
}

#[tokio::test]
#[cfg(unix)]
async fn empty_native_json_is_not_a_completed_session() {
    use agent_commander::{agent, AgentOptions, AgentStartOptions, AgentStopOptions};
    let mut controller = agent(AgentOptions {
        tool: "claude".into(),
        working_directory: "/tmp".into(),
        executable: Some("true".into()),
        json: true,
        ..Default::default()
    })
    .unwrap();
    controller
        .start(AgentStartOptions {
            attached: false,
            ..Default::default()
        })
        .await
        .unwrap();
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(5),
        controller.stop(AgentStopOptions::default()),
    )
    .await
    .unwrap()
    .unwrap();
    assert!(!result.metadata.success);
    assert_eq!(
        result.metadata.error_type.as_deref(),
        Some("incomplete_stream")
    );
}

#[test]
fn native_resume_flags_are_available_for_every_tool() {
    use agent_commander::{build_agent_command, AgentCommandOptions};
    for (tool, flag) in [
        ("claude", "--resume"),
        ("codex", "exec resume"),
        ("opencode", "--session"),
        ("agent", "--resume"),
        ("qwen", "--resume"),
        ("gemini", "--resume"),
    ] {
        let command = build_agent_command(&AgentCommandOptions {
            tool: tool.into(),
            working_directory: "/tmp".into(),
            resume: Some("previous-session".into()),
            ..Default::default()
        });
        assert!(
            command.contains(&format!("{flag} previous-session")),
            "{tool}: {command}"
        );
        if tool == "agent" {
            assert!(command.contains("--no-fork"));
        }
    }
}
