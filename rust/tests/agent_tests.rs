//! Tests for Agent CLI tool configuration (@link-assistant/agent)
//! These tests mirror the JavaScript tests in js/test/tools.test.mjs

use agent_commander::tools::agent::{
    build_args, detect_errors, extract_session_id, extract_usage, map_model_to_id, parse_output,
    AgentBuildOptions, AgentTool,
};

// Model mapping tests
#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("grok"), "opencode/grok-code");
    assert_eq!(map_model_to_id("sonnet"), "anthropic/claude-3-5-sonnet");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(map_model_to_id("custom-provider/model"), "custom-provider/model");
}

// Build args tests
#[test]
fn test_build_args_with_model() {
    let options = AgentBuildOptions {
        model: Some("grok".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--model".to_string()));
    assert!(args.contains(&"opencode/grok-code".to_string()));
}

#[test]
fn test_build_args_with_compact_json() {
    let options = AgentBuildOptions {
        compact_json: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--compact-json".to_string()));
}

#[test]
fn test_build_args_with_claude_oauth() {
    let options = AgentBuildOptions {
        use_existing_claude_oauth: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--use-existing-claude-oauth".to_string()));
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
fn test_extract_usage_from_step_finish() {
    let output = r#"{"type":"step_finish","part":{"tokens":{"input":100,"output":50},"cost":0}}
{"type":"step_finish","part":{"tokens":{"input":200,"output":75},"cost":0}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 300);
    assert_eq!(usage.output_tokens, 125);
    assert_eq!(usage.step_count, 2);
}

#[test]
fn test_extract_usage_with_cache_tokens() {
    let output = r#"{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"cache":{"read":25,"write":10}},"cost":0.01}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.cache_read_tokens, 25);
    assert_eq!(usage.cache_write_tokens, 10);
    assert!((usage.total_cost - 0.01).abs() < 0.001);
}

#[test]
fn test_extract_usage_with_reasoning_tokens() {
    let output = r#"{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"reasoning":30},"cost":0}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.reasoning_tokens, 30);
}

// Error detection tests
#[test]
fn test_detect_errors_finds_error() {
    let output = r#"{"type":"error","message":"Something went wrong"}"#;
    let result = detect_errors(output);
    assert!(result.has_error);
    assert_eq!(result.error_type, Some("error".to_string()));
}

#[test]
fn test_detect_errors_finds_step_error() {
    let output = r#"{"type":"step_error","message":"Step failed"}"#;
    let result = detect_errors(output);
    assert!(result.has_error);
    assert_eq!(result.error_type, Some("step_error".to_string()));
}

#[test]
fn test_detect_errors_normal_output() {
    let output = r#"{"type":"step_finish","part":{}}"#;
    let result = detect_errors(output);
    assert!(!result.has_error);
}

// Tool configuration tests
#[test]
fn test_agent_tool_default_values() {
    let tool = AgentTool::default();
    assert_eq!(tool.name, "agent");
    assert_eq!(tool.display_name, "@link-assistant/agent");
    assert_eq!(tool.executable, "agent");
    assert_eq!(tool.default_model, "grok-code-fast-1");
    assert!(tool.supports_json_output);
    assert!(tool.supports_json_input);
    assert!(!tool.supports_resume); // Agent doesn't have explicit resume
    assert!(!tool.supports_system_prompt); // Combined with user prompt
}
