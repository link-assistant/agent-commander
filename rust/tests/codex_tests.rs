//! Tests for Codex CLI tool configuration

use agent_commander::tools::codex::{
    build_args, extract_session_id, extract_usage, map_model_to_id, CodexBuildOptions, CodexTool,
};

#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("gpt5"), "gpt-5");
    assert_eq!(map_model_to_id("o3"), "o3");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(map_model_to_id("gpt-4-turbo"), "gpt-4-turbo");
}

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
        resume: Some("thread-123".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"resume".to_string()));
    assert!(args.contains(&"thread-123".to_string()));
}

#[test]
fn test_build_args_includes_safety_bypasses() {
    let options = CodexBuildOptions::default();
    let args = build_args(&options);
    assert!(args.contains(&"--skip-git-repo-check".to_string()));
    assert!(args.contains(&"--dangerously-bypass-approvals-and-sandbox".to_string()));
}

#[test]
fn test_extract_session_id_with_thread_id() {
    let output = "{\"thread_id\":\"thread-123\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("thread-123".to_string()));
}

#[test]
fn test_extract_session_id_with_session_id() {
    let output = "{\"session_id\":\"sess-456\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("sess-456".to_string()));
}

#[test]
fn test_extract_usage() {
    let output = "{\"usage\":{\"input_tokens\":100,\"output_tokens\":50}}";
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
}

#[test]
fn test_codex_tool_default() {
    let tool = CodexTool::default();
    assert_eq!(tool.name, "codex");
    assert_eq!(tool.executable, "codex");
    assert!(tool.supports_json_output);
    assert!(tool.supports_json_input);
    assert!(!tool.supports_system_prompt);
    assert!(tool.supports_resume);
    assert_eq!(tool.default_model, "gpt-5");
}

#[test]
fn test_parse_output_ndjson() {
    let output = "{\"type\":\"message\",\"content\":\"Hello\"}\n{\"type\":\"done\"}";
    let messages = agent_commander::tools::codex::parse_output(output);
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["type"], "message");
    assert_eq!(messages[1]["type"], "done");
}

#[test]
fn test_map_model_to_id_claude_aliases() {
    assert_eq!(map_model_to_id("claude"), "claude-3-5-sonnet");
    assert_eq!(map_model_to_id("sonnet"), "claude-3-5-sonnet");
    assert_eq!(map_model_to_id("opus"), "claude-3-opus");
}

#[test]
fn test_map_model_to_id_o3_variants() {
    assert_eq!(map_model_to_id("o3-mini"), "o3-mini");
}

#[test]
fn test_map_model_to_id_gpt_variants() {
    assert_eq!(map_model_to_id("gpt4"), "gpt-4");
    assert_eq!(map_model_to_id("gpt4o"), "gpt-4o");
    assert_eq!(map_model_to_id("gpt5-codex"), "gpt-5-codex");
}
