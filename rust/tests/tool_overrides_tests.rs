//! Tests for per-run tool overrides (issue #57): a caller replaces a failing or
//! missing part of a tool, or drives a tool that is not registered, without
//! waiting for an agent-commander release.

use agent_commander::{
    agent, build_agent_command, build_base_command, check_launch_options_against, escape_arg,
    launch_capabilities, AgentCommandOptions, AgentOptions, AgentStartOptions, AgentStopOptions,
    LaunchCapabilities, LaunchOptions, ToolOverrides,
};
use serde_json::{json, Value};
use std::sync::Arc;

fn attachments() -> LaunchOptions {
    LaunchOptions {
        attachments: vec!["shot.png".to_string(), "my shot.png".to_string()],
        ..Default::default()
    }
}

// Claude with an override builder that adds an image flag the built-in lacks.
fn claude_with_images() -> ToolOverrides {
    ToolOverrides {
        build_command: Some(Arc::new(|options: &AgentCommandOptions| {
            let mut inner = options.clone();
            inner.launch.attachments.clear();
            format!(
                "{} --image {}",
                build_base_command(&inner),
                options
                    .launch
                    .attachments
                    .iter()
                    .map(|file| escape_arg(file))
                    .collect::<Vec<_>>()
                    .join(" ")
            )
        })),
        launch_capabilities: Some(LaunchCapabilities {
            attachments: true,
            ..launch_capabilities("claude")
        }),
        ..Default::default()
    }
}

#[test]
fn an_override_builder_can_add_a_flag_the_built_in_lacks() {
    let mut options = AgentCommandOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        launch: attachments(),
        overrides: claude_with_images(),
        ..Default::default()
    };
    let command = build_agent_command(&options);
    assert!(command.starts_with("bash -c \"cd /tmp && "), "{command}");
    assert!(command.contains("claude "), "{command}");
    // The image list is escaped, then the whole command for `bash -c "..."`.
    assert!(
        command.contains(r#"--image shot.png \"my shot.png\""#),
        "{command}"
    );

    // Without the override the built-in still refuses the option.
    assert!(check_launch_options_against(
        "claude",
        &options.launch,
        &launch_capabilities("claude")
    )
    .unwrap_err()
    .contains("does not support file attachments"));
    options.overrides = ToolOverrides::default();
    let refused = std::panic::catch_unwind(|| build_agent_command(&options));
    assert!(refused.is_err());
}

#[tokio::test]
async fn agent_start_accepts_options_the_override_capabilities_allow() {
    let mut controller = agent(AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        launch: attachments(),
        tool_overrides: claude_with_images(),
        ..Default::default()
    })
    .unwrap();
    controller
        .start(AgentStartOptions {
            dry_run: true,
            ..Default::default()
        })
        .await
        .unwrap();

    let mut refused = agent(AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp".to_string(),
        launch: attachments(),
        ..Default::default()
    })
    .unwrap();
    let error = refused
        .start(AgentStartOptions {
            dry_run: true,
            ..Default::default()
        })
        .await
        .unwrap_err();
    assert!(
        error.contains("does not support file attachments"),
        "{error}"
    );
}

fn printf_lines(lines: &[Value]) -> String {
    let quoted: Vec<String> = lines.iter().map(|line| format!("'{line}'")).collect();
    format!("printf '%s\\n' {}", quoted.join(" "))
}

async fn run(tool: &str, json: bool, overrides: ToolOverrides) -> agent_commander::AgentResult {
    let mut controller = agent(AgentOptions {
        tool: tool.to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        model: Some("m1".to_string()),
        json,
        isolation: "none".to_string(),
        tool_overrides: overrides,
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
    controller.stop(AgentStopOptions::default()).await.unwrap()
}

#[tokio::test]
async fn an_unregistered_tool_runs_through_override_builder_parser_and_extractors() {
    let lines = [
        json!({"type": "init", "session": "sess-1"}),
        json!({"type": "done", "tokens": 42}),
    ];
    let command = printf_lines(&lines);
    let result = run(
        "my-agent",
        false,
        ToolOverrides {
            build_command: Some(Arc::new(move |options: &AgentCommandOptions| {
                assert_eq!(options.model.as_deref(), Some("m1"));
                command.clone()
            })),
            parse_output: Some(Arc::new(|output: &str| {
                output
                    .lines()
                    .map(|line| {
                        let mut event: Value = serde_json::from_str(line).unwrap();
                        event["custom"] = json!(true);
                        event
                    })
                    .collect()
            })),
            extract_session_id: Some(Arc::new(|output: &str| {
                let first: Value = serde_json::from_str(output.lines().next()?).ok()?;
                first["session"].as_str().map(String::from)
            })),
            extract_usage: Some(Arc::new(|output: &str| {
                let last: Value = serde_json::from_str(output.lines().last()?).ok()?;
                Some(json!({"totalTokens": last["tokens"]}))
            })),
            launch_capabilities: None,
        },
    )
    .await;
    assert_eq!(result.exit_code, 0);
    assert_eq!(result.session_id.as_deref(), Some("sess-1"));
    assert_eq!(result.usage, Some(json!({"totalTokens": 42})));
    let parsed: Vec<(Value, Value)> = result
        .parsed_output
        .unwrap()
        .iter()
        .map(|event| (event["type"].clone(), event["custom"].clone()))
        .collect();
    assert_eq!(
        parsed,
        [(json!("init"), json!(true)), (json!("done"), json!(true))]
    );
    assert_eq!(result.metadata.session_id.as_deref(), Some("sess-1"));
}

#[tokio::test]
async fn an_override_parser_replaces_the_streamed_messages_of_a_registered_tool() {
    let result = run(
        "codex",
        true,
        ToolOverrides {
            build_command: Some(Arc::new(|_: &AgentCommandOptions| {
                printf_lines(&[json!({"type": "ignored"})])
            })),
            parse_output: Some(Arc::new(|output: &str| {
                vec![json!({"type": "text", "text": output.trim()})]
            })),
            extract_session_id: Some(Arc::new(|_: &str| Some("thread-1".to_string()))),
            ..Default::default()
        },
    )
    .await;
    assert_eq!(
        result.parsed_output,
        Some(vec![
            json!({"type": "text", "text": r#"{"type":"ignored"}"#})
        ])
    );
    assert_eq!(result.session_id.as_deref(), Some("thread-1"));
}

#[test]
fn empty_overrides_keep_the_built_in_command_and_debug_hides_closures() {
    let options = AgentCommandOptions {
        tool: "codex".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        ..Default::default()
    };
    assert!(options.overrides.is_empty());
    assert!(build_agent_command(&options).contains("codex exec"));
    let debug = format!("{:?}", claude_with_images());
    assert!(debug.contains("build_command: true"), "{debug}");
    assert!(debug.contains("parse_output: false"), "{debug}");
}
