//! Tests for structured output (issue #57): the `json_schema` launch option
//! and the `structured_output` metadata field.

use agent_commander::tools::{claude, codex, qwen};
#[cfg(unix)]
use agent_commander::{agent, AgentOptions, AgentStartOptions, AgentStopOptions, ToolOverrides};
use agent_commander::{
    build_agent_command, build_normalized_result_metadata, check_launch_options_supported,
    extract_structured_output, json_schema_arg, launch_capabilities, parse_start_agent_args,
    AgentCommandOptions, BuildMetadataOptions, LaunchOptions,
};
use serde_json::{json, Value};
#[cfg(unix)]
use std::sync::Arc;

const SCHEMA: &str = r#"{ "type": "object", "properties": { "title": { "type": "string" } }, "required": ["title"], "additionalProperties": false }"#;

fn compact_schema() -> String {
    serde_json::from_str::<Value>(SCHEMA).unwrap().to_string()
}

fn with_schema() -> LaunchOptions {
    LaunchOptions {
        json_schema: Some(SCHEMA.to_string()),
        ..Default::default()
    }
}

#[test]
fn json_schema_arg_compacts_an_object_and_rejects_the_rest() {
    assert_eq!(json_schema_arg(SCHEMA), compact_schema());
    for bad in ["{bad", "[1]", "./schema.json"] {
        assert!(
            std::panic::catch_unwind(|| json_schema_arg(bad)).is_err(),
            "{bad}"
        );
    }
}

#[test]
fn claude_and_qwen_pass_the_schema_as_json_schema() {
    let claude_args = claude::build_args(&claude::ClaudeBuildOptions {
        prompt: Some("hi".to_string()),
        launch: with_schema(),
        ..Default::default()
    });
    let qwen_args = qwen::build_args(&qwen::QwenBuildOptions {
        prompt: Some("hi".to_string()),
        launch: with_schema(),
        ..Default::default()
    });
    for args in [claude_args, qwen_args] {
        let index = args.iter().position(|arg| arg == "--json-schema").unwrap();
        assert_eq!(args[index + 1], compact_schema(), "{args:?}");
    }
}

#[test]
fn codex_gets_output_schema_through_bash_process_substitution() {
    let command = codex::build_command(&codex::CodexBuildOptions {
        prompt: Some("hi".to_string()),
        resume: Some("thread-1".to_string()),
        launch: with_schema(),
        ..Default::default()
    });
    assert!(command.contains("codex exec resume thread-1 "), "{command}");
    assert!(
        command.ends_with(r#"--output-schema <(printf '%s' "{\"additionalProperties\":false,\"properties\":{\"title\":{\"type\":\"string\"}},\"required\":[\"title\"],\"type\":\"object\"}")"#),
        "{command}"
    );
    let plain = codex::build_command(&codex::CodexBuildOptions {
        prompt: Some("hi".to_string()),
        ..Default::default()
    });
    assert!(!plain.contains("output-schema"), "{plain}");
}

#[test]
fn tools_without_a_native_flag_reject_the_option() {
    for tool in ["claude", "codex", "qwen"] {
        assert!(launch_capabilities(tool).json_schema, "{tool}");
        assert!(check_launch_options_supported(tool, &with_schema()).is_ok());
    }
    for tool in ["opencode", "gemini", "agent"] {
        let error = check_launch_options_supported(tool, &with_schema()).unwrap_err();
        assert!(
            error.contains("does not support structured output")
                && error.contains("claude, codex, qwen"),
            "{error}"
        );
    }
    let options = AgentCommandOptions {
        tool: "gemini".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        launch: with_schema(),
        ..Default::default()
    };
    assert!(std::panic::catch_unwind(|| build_agent_command(&options)).is_err());
}

#[test]
fn the_cli_parses_json_schema() {
    let args: Vec<String> = [
        "--tool",
        "claude",
        "--working-directory",
        "/tmp",
        "--json-schema",
        SCHEMA,
    ]
    .iter()
    .map(ToString::to_string)
    .collect();
    assert_eq!(
        parse_start_agent_args(&args).json_schema.as_deref(),
        Some(SCHEMA)
    );
}

fn metadata(tool: &str, messages: &[Value], requested: bool) -> Option<Value> {
    build_normalized_result_metadata(BuildMetadataOptions {
        tool,
        exit_code: 0,
        parsed_output: Some(messages),
        structured_output_requested: requested,
        ..Default::default()
    })
    .structured_output
}

#[test]
fn structured_output_comes_from_the_claude_and_qwen_result_messages() {
    let claude = [
        json!({"type": "system", "subtype": "init", "session_id": "s"}),
        json!({"type": "result", "subtype": "success", "result": "", "structured_output": {"title": "Fix login"}}),
    ];
    assert_eq!(
        metadata("claude", &claude, false),
        Some(json!({"title": "Fix login"}))
    );
    let qwen = [
        json!({"type": "result", "subtype": "success", "result": "{\"title\":\"Fix login\"}", "structured_result": {"title": "Fix login"}}),
    ];
    assert_eq!(
        metadata("qwen", &qwen, false),
        Some(json!({"title": "Fix login"}))
    );
    let plain = [json!({"type": "result", "subtype": "success", "result": "x"})];
    assert_eq!(metadata("claude", &plain, true), None);
}

#[test]
fn codex_structured_output_is_its_final_agent_message_only_on_request() {
    let messages = [
        json!({"type": "thread.started", "thread_id": "t"}),
        json!({"type": "item.completed", "item": {"type": "agent_message", "text": "{\"title\":\"Fix login\"}"}}),
        json!({"type": "turn.completed", "usage": {"input_tokens": 1, "output_tokens": 1}}),
    ];
    assert_eq!(
        metadata("codex", &messages, true),
        Some(json!({"title": "Fix login"}))
    );
    assert_eq!(
        metadata("codex", &messages, false),
        None,
        "plain answers are not guessed as JSON"
    );
    // `codex exec` without `--json` prints the final message.
    assert_eq!(
        extract_structured_output("codex", &[], "{\"title\":\"Plain\"}\n", true),
        Some(json!({"title": "Plain"}))
    );
    let not_json =
        [json!({"type": "item.completed", "item": {"type": "agent_message", "text": "not json"}})];
    assert_eq!(metadata("codex", &not_json, true), None);
}

#[cfg(unix)]
#[tokio::test]
async fn an_agent_run_reports_the_structured_output_in_its_metadata() {
    let lines = [
        json!({"type": "thread.started", "thread_id": "thread-1"}),
        json!({"type": "item.completed", "item": {"id": "i", "type": "agent_message", "text": "{\"title\":\"Done\"}"}}),
        json!({"type": "turn.completed", "usage": {"input_tokens": 3, "output_tokens": 2}}),
    ];
    let quoted: Vec<String> = lines.iter().map(|line| format!("'{line}'")).collect();
    let command = format!("printf '%s\\n' {}", quoted.join(" "));
    let mut controller = agent(AgentOptions {
        tool: "codex".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("hi".to_string()),
        json: true,
        isolation: "none".to_string(),
        launch: with_schema(),
        tool_overrides: ToolOverrides {
            build_command: Some(Arc::new(move |_: &AgentCommandOptions| command.clone())),
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
    let result = controller.stop(AgentStopOptions::default()).await.unwrap();
    assert_eq!(result.exit_code, 0);
    assert_eq!(
        result.metadata.structured_output,
        Some(json!({"title": "Done"}))
    );
}
