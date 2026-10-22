//! Tests for live input into a running agent (issue #57).

use agent_commander::{
    agent, build_agent_command, build_interrupt_frame, build_user_input_frame, supports_live_input,
    AgentCommandOptions, AgentOptions, AgentStartOptions, AgentStopOptions,
};
use serde_json::{json, Value};

// Echoes every stdin frame, answers each user frame with a result and
// reports end of input, like `claude -p --input-format stream-json`.
#[cfg(unix)]
const FAKE_CLAUDE: &str = r#"#!/usr/bin/env bash
printf '%s\n' '{"type":"system","subtype":"init","session_id":"live-1"}'
turn=0
while IFS= read -r line; do
  printf '{"type":"echo","frame":%s}\n' "$line"
  case "$line" in *control_request*) continue ;; esac
  turn=$((turn + 1))
  printf '{"type":"result","subtype":"success","is_error":false,"result":"turn %s","session_id":"live-1"}\n' "$turn"
done
printf '%s\n' '{"type":"echo","eof":true}'
"#;

#[test]
fn live_input_frames_match_each_tool_stdin_protocol() {
    assert_eq!(
        build_user_input_frame("claude", &json!("hi"), None).unwrap(),
        json!({"type": "user", "message": {"role": "user", "content": "hi"}})
    );
    let blocks = json!([
        {"type": "text", "text": "What is this?"},
        {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": "iVBORw0="}}
    ]);
    assert_eq!(
        build_user_input_frame("claude", &blocks, None).unwrap()["message"]["content"],
        blocks
    );
    assert_eq!(
        build_user_input_frame("agent", &json!("go"), Some("Be brief")).unwrap(),
        json!({"type": "user", "message": "Be brief\n\ngo"})
    );
    assert_eq!(
        build_user_input_frame("qwen", &json!("go"), Some("Be brief")).unwrap(),
        json!({"type": "user", "message": {"role": "user", "content": "Be brief\n\ngo"}})
    );
    assert!(build_user_input_frame("agent", &blocks, None)
        .unwrap_err()
        .contains("accepts only text"));
    assert_eq!(
        build_interrupt_frame("claude", Some("r1")).unwrap(),
        json!({"type": "control_request", "request_id": "r1", "request": {"subtype": "interrupt"}})
    );
    assert_eq!(
        build_interrupt_frame("qwen", None).unwrap()["request"]["subtype"],
        "interrupt"
    );
    assert!(build_interrupt_frame("agent", None)
        .unwrap_err()
        .contains("no interrupt control request"));
    let live: Vec<&str> = ["claude", "agent", "codex", "opencode", "gemini", "qwen"]
        .into_iter()
        .filter(|tool| supports_live_input(tool))
        .collect();
    assert_eq!(live, ["claude", "agent", "qwen"]);
}

#[test]
fn stream_input_commands_read_frames_from_stdin() {
    let command = |tool: &str| {
        build_agent_command(&AgentCommandOptions {
            tool: tool.into(),
            working_directory: "/tmp".into(),
            json: true,
            stream_input: true,
            isolation: "none".into(),
            ..Default::default()
        })
    };
    let claude = command("claude");
    assert!(claude.contains(" -p "), "{claude}");
    assert!(claude.contains("--input-format stream-json"), "{claude}");
    let qwen = command("qwen");
    assert!(qwen.contains("--input-format stream-json"), "{qwen}");
    assert!(!qwen.contains(" -p "), "{qwen}");
    let agent_command = command("agent");
    assert!(
        agent_command.contains("--input-format stream-json"),
        "{agent_command}"
    );
    assert!(!agent_command.contains("printf"), "{agent_command}");
}

#[tokio::test]
async fn live_input_is_rejected_for_tools_and_modes_without_a_stdin_channel() {
    let options = |tool: &str| AgentOptions {
        tool: tool.into(),
        working_directory: "/tmp".into(),
        prompt: Some("hi".into()),
        isolation: "none".into(),
        live_input: true,
        ..Default::default()
    };
    let mut codex = agent(options("codex")).unwrap();
    let error = codex.start(AgentStartOptions::default()).await.unwrap_err();
    assert!(error.contains("does not read live input"), "{error}");

    let mut screen = agent(AgentOptions {
        isolation: "screen".into(),
        screen_name: Some("live".into()),
        ..options("claude")
    })
    .unwrap();
    let error = screen
        .start(AgentStartOptions::default())
        .await
        .unwrap_err();
    assert!(error.contains("attached run without isolation"), "{error}");

    let mut not_live = agent(AgentOptions {
        live_input: false,
        ..options("claude")
    })
    .unwrap();
    let error = not_live.send_message("hi").await.unwrap_err();
    assert!(error.contains("not started with live_input"), "{error}");
}

#[cfg(unix)]
#[tokio::test]
async fn live_input_queues_follow_up_messages_and_interrupts_into_one_session() {
    use std::os::unix::fs::PermissionsExt;

    let bin_dir = tempfile::tempdir().unwrap();
    let fake = bin_dir.path().join("claude");
    std::fs::write(&fake, FAKE_CLAUDE).unwrap();
    std::fs::set_permissions(&fake, std::fs::Permissions::from_mode(0o755)).unwrap();

    let mut controller = agent(AgentOptions {
        tool: "claude".into(),
        working_directory: "/tmp".into(),
        prompt: Some("first".into()),
        isolation: "none".into(),
        executable: Some(fake.to_string_lossy().into_owned()),
        live_input: true,
        ..Default::default()
    })
    .unwrap();
    controller
        .start(AgentStartOptions::default())
        .await
        .unwrap();
    controller.send_message("second").await.unwrap();
    controller.interrupt().await.unwrap();
    let result = controller.stop(AgentStopOptions::default()).await.unwrap();

    assert_eq!(result.exit_code, 0, "{}", result.plain_output);
    let frames: Vec<String> = result
        .parsed_output
        .unwrap_or_default()
        .iter()
        .filter(|message| message["type"] == "echo")
        .map(|message| match &message["frame"] {
            Value::Null => "eof".to_string(),
            frame if frame["type"] == "user" => {
                frame["message"]["content"].as_str().unwrap().to_string()
            }
            frame => frame["request"]["subtype"].as_str().unwrap().to_string(),
        })
        .collect();
    assert_eq!(frames, ["first", "second", "interrupt", "eof"]);
    assert_eq!(result.session_id.as_deref(), Some("live-1"));
    let error = controller.send_message("late").await.unwrap_err();
    assert!(error.contains("input is closed"), "{error}");
}
