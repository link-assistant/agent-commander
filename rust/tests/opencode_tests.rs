//! Tests for OpenCode CLI tool configuration
//! These tests mirror the JavaScript tests in js/test/tools.test.mjs

use agent_commander::tools::opencode::{
    build_args, extract_session_id, extract_usage, map_model_to_id, parse_output,
    OpencodeBuildOptions, OpencodeTool,
};

// Model mapping tests
#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("grok"), "opencode/grok-code");
    assert_eq!(map_model_to_id("gemini"), "google/gemini-pro");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(
        map_model_to_id("custom-provider/model"),
        "custom-provider/model"
    );
}

// Build args tests
#[test]
fn test_build_args_includes_run() {
    let options = OpencodeBuildOptions::default();
    let args = build_args(&options);
    assert!(args.contains(&"run".to_string()));
}

#[test]
fn test_build_args_with_json() {
    let options = OpencodeBuildOptions {
        json: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--format".to_string()));
    assert!(args.contains(&"json".to_string()));
}

#[test]
fn test_build_args_with_model() {
    let options = OpencodeBuildOptions {
        model: Some("grok".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--model".to_string()));
    assert!(args.contains(&"opencode/grok-code".to_string()));
}

#[test]
fn test_build_args_with_resume() {
    let options = OpencodeBuildOptions {
        resume: Some("session123".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--resume".to_string()));
    assert!(args.contains(&"session123".to_string()));
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
fn test_extract_session_id() {
    let output = "{\"session_id\":\"abc123\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("abc123".to_string()));
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
fn test_opencode_tool_default_values() {
    let tool = OpencodeTool::default();
    assert_eq!(tool.name, "opencode");
    assert_eq!(tool.display_name, "OpenCode CLI");
    assert_eq!(tool.executable, "opencode");
    assert_eq!(tool.default_model, "grok-code-fast-1");
    assert!(tool.supports_json_output);
    assert!(tool.supports_json_input);
    assert!(tool.supports_resume);
    assert!(!tool.supports_system_prompt); // Combined with user prompt
}
