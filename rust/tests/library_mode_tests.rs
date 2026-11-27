//! Secrets, system prompts and JSON Schemas stay off the command line
//! (issue #60): `ps` and `/proc/<pid>/cmdline` are readable by other users.

use agent_commander::{build_child_environment, InheritEnv};

fn pairs(items: &[(&str, &str)]) -> Vec<(String, String)> {
    items
        .iter()
        .map(|(k, v)| ((*k).to_string(), (*v).to_string()))
        .collect()
}

#[test]
fn build_child_environment_modes() {
    let parent = pairs(&[("PATH", "/bin"), ("HOME", "/h"), ("DB_PASSWORD", "pw")]);
    let unset = vec!["DB_PASSWORD".to_string()];
    let env = build_child_environment(parent.clone(), &InheritEnv::All, None, &unset, &[]).unwrap();
    assert_eq!(env, pairs(&[("PATH", "/bin"), ("HOME", "/h")]));

    let only = InheritEnv::Only(vec!["PATH".into(), "MISSING".into()]);
    let env =
        build_child_environment(parent.clone(), &only, None, &[], &pairs(&[("KEY", "v")])).unwrap();
    assert_eq!(env, pairs(&[("PATH", "/bin"), ("KEY", "v")]));

    let env = build_child_environment(parent.clone(), &InheritEnv::None, None, &[], &[]).unwrap();
    assert_eq!(env, Vec::new());

    let explicit = pairs(&[("ONLY", "1")]);
    let env = build_child_environment(parent.clone(), &InheritEnv::All, Some(&explicit), &[], &[])
        .unwrap();
    assert_eq!(env, explicit);

    let bad = InheritEnv::Only(vec!["bad-name".into()]);
    assert!(build_child_environment(parent, &bad, None, &[], &[]).is_err());
}

#[cfg(target_os = "linux")]
#[tokio::test]
async fn secrets_prompts_and_schema_stay_off_the_command_line() {
    use agent_commander::{
        agent, AgentOptions, AgentStartOptions, AgentStopOptions, LaunchOptions,
    };
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let out = dir.path();
    let fake = out.join("claude");
    std::fs::write(
        &fake,
        format!(
            r#"#!/bin/bash
out={out:?}
tr '\0' ' ' < /proc/$PPID/cmdline > "$out/shell-cmdline"
printf '%s\n' "$@" > "$out/argv"
env > "$out/env"
while [ $# -gt 0 ]; do
  case "$1" in
    --system-prompt-file) cat "$2" > "$out/system-prompt"; shift ;;
    --append-system-prompt-file) cat "$2" > "$out/append-system-prompt"; shift ;;
    --json-schema) printf '%s' "$2" > "$out/schema"; shift ;;
  esac
  shift
done
printf '%s\n' '{{"type":"result","subtype":"success","session_id":"s","result":"ok"}}'
"#,
            out = out.display().to_string()
        ),
    )
    .unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

    std::env::set_var("AGENT_COMMANDER_TEST_DB_PASSWORD", "db-secret");
    let mut controller = agent(AgentOptions {
        tool: "claude".into(),
        working_directory: "/tmp".into(),
        prompt: Some("user prompt".into()),
        system_prompt: Some("PRIVATE-SYSTEM-PROMPT".into()),
        append_system_prompt: Some("PRIVATE-APPEND".into()),
        json: true,
        executable: Some(fake.display().to_string()),
        extra_env: pairs(&[
            ("API_TOKEN", "sk-very-secret"),
            ("CLAUDE_CODE_MAX_OUTPUT_TOKENS", "256"),
        ]),
        inherit_env: InheritEnv::Only(vec!["PATH".into()]),
        launch: LaunchOptions {
            json_schema: Some(r#"{"type":"object","properties":{"secretField":{}}}"#.into()),
            max_output_tokens: Some(128),
            ..Default::default()
        },
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
    controller.stop(AgentStopOptions::default()).await.unwrap();

    let read = |name: &str| std::fs::read_to_string(out.join(name)).unwrap();
    let shell = read("shell-cmdline");
    for secret in [
        "sk-very-secret",
        "PRIVATE-SYSTEM-PROMPT",
        "PRIVATE-APPEND",
        "secretField",
    ] {
        assert!(!shell.contains(secret), "{secret} in {shell}");
    }
    let argv = read("argv");
    assert!(!argv.contains("PRIVATE"), "{argv}");
    assert!(argv.contains("--system-prompt-file"));
    assert!(argv.contains("--append-system-prompt-file"));
    assert_eq!(read("system-prompt"), "PRIVATE-SYSTEM-PROMPT");
    assert_eq!(read("append-system-prompt"), "PRIVATE-APPEND");
    let schema: serde_json::Value = serde_json::from_str(&read("schema")).unwrap();
    assert_eq!(schema["properties"]["secretField"], serde_json::json!({}));
    let env = read("env");
    assert!(
        env.lines()
            .any(|line| line == "CLAUDE_CODE_MAX_OUTPUT_TOKENS=128"),
        "{env}"
    );
    assert!(!argv.contains("CLAUDE_CODE_MAX_OUTPUT_TOKENS"), "{argv}");
    assert!(
        env.lines().any(|l| l == "API_TOKEN=sk-very-secret"),
        "{env}"
    );
    assert!(!env.contains("AGENT_COMMANDER_TEST_DB_PASSWORD"));
}
