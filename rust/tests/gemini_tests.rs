//! Tests for Gemini CLI tool configuration

use agent_commander::tools::gemini::{
    build_args, detect_errors, extract_session_id, extract_usage, map_model_to_id,
    GeminiBuildOptions, GeminiTool,
};

#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("flash"), "gemini-2.5-flash");
    assert_eq!(map_model_to_id("pro"), "gemini-2.5-pro");
    assert_eq!(map_model_to_id("3-flash"), "gemini-3-flash-preview");
    assert_eq!(map_model_to_id("lite"), "gemini-2.5-flash-lite");
    assert_eq!(map_model_to_id("3-pro"), "gemini-3-pro-preview");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(map_model_to_id("gemini-2.0-flash"), "gemini-2.0-flash");
}

#[test]
fn test_build_args_with_prompt() {
    let options = GeminiBuildOptions {
        prompt: Some("Hello".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"-p".to_string()));
    assert!(args.contains(&"Hello".to_string()));
}

#[test]
fn test_build_args_with_model() {
    let options = GeminiBuildOptions {
        model: Some("flash".to_string()),
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"-m".to_string()));
    assert!(args.contains(&"gemini-2.5-flash".to_string()));
}

#[test]
fn test_build_args_with_yolo() {
    let options = GeminiBuildOptions {
        yolo: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--yolo".to_string()));
}

#[test]
fn test_build_args_with_sandbox() {
    let options = GeminiBuildOptions {
        sandbox: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--sandbox".to_string()));
}

#[test]
fn test_build_args_with_json_output() {
    let options = GeminiBuildOptions {
        json: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--output-format".to_string()));
    assert!(args.contains(&"stream-json".to_string()));
}

#[test]
fn test_build_args_with_debug() {
    let options = GeminiBuildOptions {
        debug: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"-d".to_string()));
}

#[test]
fn test_build_args_with_checkpointing() {
    let options = GeminiBuildOptions {
        checkpointing: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--checkpointing".to_string()));
}

#[test]
fn test_build_args_with_interactive() {
    let options = GeminiBuildOptions {
        prompt: Some("Hello".to_string()),
        interactive: true,
        ..Default::default()
    };
    let args = build_args(&options);
    assert!(args.contains(&"-i".to_string()));
    assert!(args.contains(&"Hello".to_string()));
    assert!(!args.contains(&"-p".to_string()));
}

#[test]
fn test_parse_output_ndjson() {
    let output = "{\"type\":\"message\",\"content\":\"Hello\"}\n{\"type\":\"done\"}";
    let messages = agent_commander::tools::gemini::parse_output(output);
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

#[test]
fn test_extract_session_id_conversation() {
    let output = "{\"conversation_id\":\"conv456\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("conv456".to_string()));
}

#[test]
fn test_extract_usage() {
    let output = "{\"usage\":{\"input_tokens\":100,\"output_tokens\":50}}";
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.total_tokens, 150);
}

#[test]
fn test_extract_usage_gemini_format() {
    let output =
        "{\"usageMetadata\":{\"promptTokenCount\":100,\"candidatesTokenCount\":50,\"totalTokenCount\":150}}";
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.total_tokens, 150);
}

#[test]
fn test_detect_errors_with_error() {
    let output = "{\"type\":\"error\",\"message\":\"Something went wrong\"}";
    let result = detect_errors(output);
    assert!(result.has_error);
    assert_eq!(result.error_type, Some("error".to_string()));
    assert_eq!(result.message, Some("Something went wrong".to_string()));
}

#[test]
fn test_detect_errors_no_error() {
    let output = "{\"type\":\"message\",\"content\":\"Hello\"}";
    let result = detect_errors(output);
    assert!(!result.has_error);
}

#[test]
fn test_gemini_tool_default() {
    let tool = GeminiTool::default();
    assert_eq!(tool.name, "gemini");
    assert_eq!(tool.executable, "gemini");
    assert!(tool.supports_json_output);
    assert!(!tool.supports_json_input);
    assert!(tool.supports_yolo);
    assert!(tool.supports_sandbox);
    assert_eq!(tool.default_model, "gemini-2.5-flash");
}

#[test]
fn test_gemini_build_options_new() {
    let options = GeminiBuildOptions::new();
    assert!(options.yolo); // yolo should be true by default for autonomous use
}

#[test]
fn test_gemini_tool_supports_yolo() {
    let tool = GeminiTool::default();
    assert!(tool.supports_yolo);
}

#[test]
fn test_gemini_tool_supports_sandbox() {
    let tool = GeminiTool::default();
    assert!(tool.supports_sandbox);
}

#[test]
fn test_gemini_tool_supports_checkpointing() {
    let tool = GeminiTool::default();
    assert!(tool.supports_checkpointing);
}

#[test]
fn test_gemini_tool_supports_debug() {
    let tool = GeminiTool::default();
    assert!(tool.supports_debug);
}

#[test]
fn test_detect_errors_with_error_field() {
    let output = "{\"error\":\"API rate limit exceeded\"}";
    let result = detect_errors(output);
    assert!(result.has_error);
    assert_eq!(result.message, Some("API rate limit exceeded".to_string()));
}

#[test]
fn test_extract_usage_camel_case() {
    let output = "{\"usage\":{\"inputTokens\":100,\"outputTokens\":50}}";
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.total_tokens, 150);
}
