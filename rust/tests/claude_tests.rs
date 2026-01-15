//! Tests for Claude Code CLI tool configuration
//! These tests mirror the JavaScript tests in js/test/tools.test.mjs

use agent_commander::tools::claude::{
    build_args, extract_session_id, extract_usage, map_model_to_id, parse_output,
    ClaudeBuildOptions, ClaudeTool,
};

// Model mapping tests
#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("sonnet"), "claude-sonnet-4-5-20250929");
    assert_eq!(map_model_to_id("opus"), "claude-opus-4-5-20251101");
    assert_eq!(map_model_to_id("haiku"), "claude-haiku-4-5-20251001");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(
        map_model_to_id("claude-3-opus-20240229"),
        "claude-3-opus-20240229"
    );
}

// Build args tests
#[test]
fn test_build_args_with_prompt() {
    let options = ClaudeBuildOptions {
        prompt: Some("Hello".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--prompt".to_string()));
    assert!(args.contains(&"Hello".to_string()));
}

#[test]
fn test_build_args_with_model() {
    let options = ClaudeBuildOptions {
        model: Some("sonnet".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--model".to_string()));
    assert!(args.contains(&"claude-sonnet-4-5-20250929".to_string()));
}

#[test]
fn test_build_args_always_includes_dangerously_skip_permissions() {
    let options = ClaudeBuildOptions::new();
    let args = build_args(&options);
    assert!(args.contains(&"--dangerously-skip-permissions".to_string()));

    let default_options = ClaudeBuildOptions::default();
    let default_args = build_args(&default_options);
    assert!(default_args.contains(&"--dangerously-skip-permissions".to_string()));
}

#[test]
fn test_build_args_uses_stream_json_format() {
    let options = ClaudeBuildOptions {
        json: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--output-format".to_string()));
    assert!(args.contains(&"stream-json".to_string()));
    assert!(!args
        .iter()
        .filter(|a| *a != &"stream-json")
        .any(|a| a == "json"));
}

#[test]
fn test_build_args_with_fallback_model() {
    let options = ClaudeBuildOptions {
        model: Some("opus".to_string()),
        fallback_model: Some("sonnet".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--model".to_string()));
    assert!(args.contains(&"claude-opus-4-5-20251101".to_string()));
    assert!(args.contains(&"--fallback-model".to_string()));
    assert!(args.contains(&"claude-sonnet-4-5-20250929".to_string()));
}

#[test]
fn test_build_args_with_append_system_prompt() {
    let options = ClaudeBuildOptions {
        append_system_prompt: Some("Extra instructions".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--append-system-prompt".to_string()));
    assert!(args.contains(&"Extra instructions".to_string()));
}

#[test]
fn test_build_args_with_session_management() {
    let options = ClaudeBuildOptions {
        session_id: Some("123e4567-e89b-12d3-a456-426614174000".to_string()),
        resume: Some("abc123".to_string()),
        fork_session: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--session-id".to_string()));
    assert!(args.contains(&"123e4567-e89b-12d3-a456-426614174000".to_string()));
    assert!(args.contains(&"--resume".to_string()));
    assert!(args.contains(&"abc123".to_string()));
    assert!(args.contains(&"--fork-session".to_string()));
}

#[test]
fn test_build_args_with_verbose() {
    let options = ClaudeBuildOptions {
        verbose: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--verbose".to_string()));
}

#[test]
fn test_build_args_with_json_input() {
    let options = ClaudeBuildOptions {
        json_input: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--input-format".to_string()));
    assert!(args.contains(&"stream-json".to_string()));
}

#[test]
fn test_build_args_with_replay_user_messages() {
    let options = ClaudeBuildOptions {
        replay_user_messages: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--replay-user-messages".to_string()));
}

// Output parsing tests
#[test]
fn test_parse_output_ndjson() {
    let output = "{\"type\":\"message\",\"content\":\"Hello\"}\n{\"type\":\"done\"}";
    let messages = parse_output(output);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["type"], "message");
    assert_eq!(messages[1]["type"], "done");
}

#[test]
fn test_extract_session_id() {
    let output = "{\"session_id\":\"abc123\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("abc123".to_string()));
}

// Usage extraction tests
#[test]
fn test_extract_usage_from_messages() {
    let output = r#"{"message":{"usage":{"input_tokens":100,"output_tokens":50,"cache_creation_input_tokens":10,"cache_read_input_tokens":5}}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_creation_tokens, 10);
    assert_eq!(usage.cache_read_tokens, 5);
}

// Capability flags tests
#[test]
fn test_claude_tool_supports_new_capabilities() {
    let tool = ClaudeTool::default();
    assert!(tool.supports_json_input);
    assert!(tool.supports_append_system_prompt);
    assert!(tool.supports_fork_session);
    assert!(tool.supports_session_id);
    assert!(tool.supports_fallback_model);
    assert!(tool.supports_verbose);
    assert!(tool.supports_replay_user_messages);
}

#[test]
fn test_claude_tool_default_values() {
    let tool = ClaudeTool::default();
    assert_eq!(tool.name, "claude");
    assert_eq!(tool.display_name, "Claude Code CLI");
    assert_eq!(tool.executable, "claude");
    assert_eq!(tool.default_model, "sonnet");
    assert!(tool.supports_system_prompt);
    assert!(tool.supports_json_output);
}
