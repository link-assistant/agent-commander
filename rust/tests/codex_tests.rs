//! Tests for Codex CLI tool configuration
//! These tests mirror the JavaScript tests in js/test/tools.test.mjs

use agent_commander::tools::codex::{
    build_args, extract_session_id, extract_usage, map_model_to_id, parse_output,
    CodexBuildOptions, CodexTool,
};

// Model mapping tests
#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("gpt5"), "gpt-5");
    assert_eq!(map_model_to_id("o3"), "o3");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(map_model_to_id("custom-model"), "custom-model");
}

// Build args tests
#[test]
fn test_build_args_includes_exec() {
    let options = CodexBuildOptions::default();
    let args = build_args(&options);
    assert!(args.contains(&"exec".to_string()));
}

#[test]
fn test_build_args_with_json() {
    let options = CodexBuildOptions {
        json: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--json".to_string()));
}

#[test]
fn test_build_args_includes_bypass_flags() {
    let options = CodexBuildOptions::default();
    let args = build_args(&options);
    assert!(args.contains(&"--skip-git-repo-check".to_string()));
    assert!(args.contains(&"--dangerously-bypass-approvals-and-sandbox".to_string()));
}

#[test]
fn test_build_args_with_model() {
    let options = CodexBuildOptions {
        model: Some("gpt5".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--model".to_string()));
    assert!(args.contains(&"gpt-5".to_string()));
}

#[test]
fn test_build_args_with_resume() {
    let options = CodexBuildOptions {
        resume: Some("thread123".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"resume".to_string()));
    assert!(args.contains(&"thread123".to_string()));
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

// Session ID extraction tests
#[test]
fn test_extract_session_id_with_thread_id() {
    let output = "{\"thread_id\":\"thread-123\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("thread-123".to_string()));
}

#[test]
fn test_extract_session_id_with_session_id() {
    let output = "{\"session_id\":\"session-456\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("session-456".to_string()));
}

// Usage extraction tests
#[test]
fn test_extract_usage_from_output() {
    let output = r#"{"usage":{"input_tokens":100,"output_tokens":50}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
}

// Tool configuration tests
#[test]
fn test_codex_tool_default_values() {
    let tool = CodexTool::default();
    assert_eq!(tool.name, "codex");
    assert_eq!(tool.display_name, "Codex CLI");
    assert_eq!(tool.executable, "codex");
    assert_eq!(tool.default_model, "gpt-5");
    assert!(tool.supports_json_output);
    assert!(tool.supports_json_input);
    assert!(tool.supports_resume);
    assert!(!tool.supports_system_prompt); // Combined with user prompt
}
