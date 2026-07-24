#![cfg(unix)]

use agent_commander::tui::{
    build_agent_tui_launch, capture_agent_tui, normalize_tui_transcript, AgentTuiEvent,
    AgentTuiOptions,
};
use command_stream::terminal::{TerminalInteraction, TerminalKey, TerminalResize};
use std::time::Duration;
use tempfile::tempdir;

const TOOLS: [&str; 6] = ["claude", "codex", "opencode", "agent", "gemini", "qwen"];

#[test]
fn selects_interactive_launches_for_every_supported_tool() {
    for tool in TOOLS {
        let launch = build_agent_tui_launch(&AgentTuiOptions {
            tool: tool.into(),
            working_directory: "/workspace".into(),
            executable: Some(format!("{tool}-test")),
            model: Some("test-model".into()),
            ..AgentTuiOptions::default()
        })
        .expect("interactive launch");

        assert_eq!(launch.file, format!("{tool}-test"));
        assert_eq!(
            launch.cwd.expect("working directory").to_string_lossy(),
            "/workspace"
        );
        for headless in ["exec", "run", "--json", "stream-json"] {
            assert!(!launch.args.iter().any(|argument| argument == headless), "{tool}");
        }
    }
}

#[test]
fn drives_and_normalizes_every_agent_client() {
    let script = r#"
printf '\033[2J\033[Hready:%s:%s\n' "$0" "$(stty size)"
IFS= read -r answer
printf '\033[2J\033[Huser:%s\ntool_call:read README.md\nwaiting-resize:%s\n' "$answer" "$(stty size)"
while [ "$(stty size)" != "10 40" ]; do sleep 0.01; done
printf '\033[2J\033[Huser:%s\ntool_call:read README.md\nassistant:%s completed\nresized:%s\n' "$answer" "$0" "$(stty size)"
"#;

    for tool in TOOLS {
        let artifacts = tempdir().expect("artifact directory");
        let capture = capture_agent_tui(AgentTuiOptions {
            tool: tool.into(),
            working_directory: std::env::current_dir().expect("current directory"),
            executable: Some("/bin/sh".into()),
            prefix_args: vec!["-c".into(), script.into(), tool.into()],
            prompt: Some("hello".into()),
            cols: 24,
            rows: 6,
            settle_duration: Duration::from_millis(10),
            timeout: Duration::from_secs(3),
            interactions: vec![TerminalInteraction {
                after: Some("waiting-resize".into()),
                resize: Some(TerminalResize { cols: 40, rows: 10 }),
                ..TerminalInteraction::default()
            }],
            artifact_directory: Some(artifacts.path().into()),
            ..AgentTuiOptions::default()
        })
        .expect("interactive capture");

        assert_eq!(capture.terminal.exit_code, 0, "{tool}");
        assert_eq!(
            capture.events,
            vec![
                AgentTuiEvent::Message {
                    role: "user".into(),
                    content: "hello".into(),
                },
                AgentTuiEvent::ToolCall {
                    name: "read".into(),
                    input: "README.md".into(),
                },
                AgentTuiEvent::Message {
                    role: "assistant".into(),
                    content: format!("{tool} completed"),
                },
            ],
            "{tool}"
        );
        assert!(capture.terminal.transcript.contains("resized:10 40"), "{tool}");
        assert!(artifacts.path().join("recording.svg").is_file(), "{tool}");
    }
}

#[test]
fn keeps_repeated_semantic_events_in_order() {
    assert_eq!(
        normalize_tui_transcript(
            "user:same\nassistant:first\nuser:same\ntool_call:read README.md"
        ),
        vec![
            AgentTuiEvent::Message {
                role: "user".into(),
                content: "same".into(),
            },
            AgentTuiEvent::Message {
                role: "assistant".into(),
                content: "first".into(),
            },
            AgentTuiEvent::Message {
                role: "user".into(),
                content: "same".into(),
            },
            AgentTuiEvent::ToolCall {
                name: "read".into(),
                input: "README.md".into(),
            },
        ]
    );
}

#[test]
fn prompt_uses_enter_control_key() {
    let options = AgentTuiOptions {
        prompt_key: TerminalKey::Enter,
        ..AgentTuiOptions::default()
    };
    assert_eq!(options.prompt_key, TerminalKey::Enter);
}
