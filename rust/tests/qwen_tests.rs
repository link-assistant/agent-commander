//! Tests for Qwen Code CLI tool configuration
//! These tests mirror the JavaScript tests in js/test/tools.test.mjs

use agent_commander::tools::qwen::{
    build_args, build_command, detect_errors, extract_session_id, extract_usage, map_model_to_id,
    QwenBuildOptions, QwenTool,
};

// Model mapping tests
#[test]
fn test_map_model_to_id_with_alias() {
    assert_eq!(map_model_to_id("qwen3-coder"), "qwen3-coder-480a35");
    assert_eq!(map_model_to_id("coder"), "qwen3-coder-480a35");
    assert_eq!(map_model_to_id("gpt-4o"), "gpt-4o");
}

#[test]
fn test_map_model_to_id_with_full_id() {
    assert_eq!(map_model_to_id("custom-model"), "custom-model");
}

// Build args tests
#[test]
fn test_build_args_with_prompt() {
    let options = QwenBuildOptions {
        prompt: Some("Hello".to_string()),
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"-p".to_string()));
    assert!(args.contains(&"Hello".to_string()));
}

#[test]
fn test_build_args_with_model() {
    let options = QwenBuildOptions {
        model: Some("qwen3-coder".to_string()),
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--model".to_string()));
    assert!(args.contains(&"qwen3-coder-480a35".to_string()));
}

#[test]
fn test_build_args_uses_stream_json_output_format_by_default() {
    let options = QwenBuildOptions::new();
    let args = build_args(&options);
    assert!(args.contains(&"--output-format".to_string()));
    assert!(args.contains(&"stream-json".to_string()));
}

#[test]
fn test_build_args_with_json_output_format() {
    let options = QwenBuildOptions {
        stream_json: false,
        json: true,
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--output-format".to_string()));
    assert!(args.contains(&"json".to_string()));
    assert!(!args.contains(&"stream-json".to_string()));
}

#[test]
fn test_build_args_includes_yolo_by_default() {
    let options = QwenBuildOptions::new();
    let args = build_args(&options);
    assert!(args.contains(&"--yolo".to_string()));
}

#[test]
fn test_build_args_with_resume() {
    let options = QwenBuildOptions {
        resume: Some("session123".to_string()),
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--resume".to_string()));
    assert!(args.contains(&"session123".to_string()));
}

#[test]
fn test_build_args_with_continue() {
    let options = QwenBuildOptions {
        continue_session: true,
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--continue".to_string()));
}

#[test]
fn test_build_args_with_all_files() {
    let options = QwenBuildOptions {
        all_files: true,
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--all-files".to_string()));
}

#[test]
fn test_build_args_with_include_directories() {
    let options = QwenBuildOptions {
        include_directories: vec!["src".to_string(), "lib".to_string()],
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.iter().any(|a| a == "--include-directories"));
    assert!(args.contains(&"src".to_string()));
    assert!(args.contains(&"lib".to_string()));
}

#[test]
fn test_build_args_with_include_partial_messages() {
    let options = QwenBuildOptions {
        stream_json: true,
        include_partial_messages: true,
        ..QwenBuildOptions::new()
    };
    let args = build_args(&options);
    assert!(args.contains(&"--include-partial-messages".to_string()));
}

// Output parsing tests
#[test]
fn test_parse_output_with_ndjson() {
    let output = "{\"type\":\"message\",\"content\":\"Hello\"}\n{\"type\":\"done\"}";
    let messages = agent_commander::tools::qwen::parse_output(output);
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

#[test]
fn test_extract_session_id_with_session_id_format() {
    let output = "{\"sessionId\":\"xyz789\"}\n{\"type\":\"done\"}";
    let session_id = extract_session_id(output);
    assert_eq!(session_id, Some("xyz789".to_string()));
}

// Usage extraction tests
#[test]
fn test_extract_usage_from_output() {
    let output = r#"{"usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150}}
{"usage":{"input_tokens":200,"output_tokens":75}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 300);
    assert_eq!(usage.output_tokens, 125);
    assert_eq!(usage.total_tokens, 150); // First message had explicit total
}

#[test]
fn test_extract_usage_calculates_total_if_not_provided() {
    let output = r#"{"usage":{"input_tokens":100,"output_tokens":50}}"#;
    let usage = extract_usage(output);
    assert_eq!(usage.input_tokens, 100);
    assert_eq!(usage.output_tokens, 50);
    assert_eq!(usage.total_tokens, 150); // Calculated from input + output
}

// Error detection tests
#[test]
fn test_detect_errors_finds_error_messages() {
    let output = r#"{"type":"error","message":"Something went wrong"}"#;
    let result = detect_errors(output);
    assert!(result.has_error);
    assert_eq!(result.error_type, Some("error".to_string()));
    assert_eq!(result.message, Some("Something went wrong".to_string()));
}

#[test]
fn test_detect_errors_with_error_field() {
    let output = r#"{"error":"API rate limit exceeded"}"#;
    let result = detect_errors(output);
    assert!(result.has_error);
    assert_eq!(result.message, Some("API rate limit exceeded".to_string()));
}

#[test]
fn test_detect_errors_returns_false_for_normal_output() {
    let output = r#"{"type":"message","content":"Hello"}"#;
    let result = detect_errors(output);
    assert!(!result.has_error);
}

// Capability flags tests
#[test]
fn test_capability_flags_are_correct() {
    let tool = QwenTool::default();
    assert!(tool.supports_json_output);
    assert!(tool.supports_json_input);
    assert!(tool.supports_resume);
    assert!(tool.supports_continue_session);
    assert!(tool.supports_yolo);
    assert!(tool.supports_all_files);
    assert!(tool.supports_include_directories);
    assert!(tool.supports_include_partial_messages);
}

// Build command tests
#[test]
fn test_build_command_constructs_correct_command() {
    let options = QwenBuildOptions {
        prompt: Some("Review code".to_string()),
        model: Some("qwen3-coder".to_string()),
        ..QwenBuildOptions::new()
    };
    let cmd = build_command(&options);
    assert!(cmd.contains("qwen"));
    assert!(cmd.contains("-p"));
    assert!(cmd.contains("Review code"));
    assert!(cmd.contains("--model"));
    assert!(cmd.contains("qwen3-coder-480a35"));
}

#[test]
fn test_build_command_combines_system_and_user_prompt() {
    let options = QwenBuildOptions {
        prompt: Some("Review code".to_string()),
        system_prompt: Some("You are helpful".to_string()),
        ..QwenBuildOptions::new()
    };
    let cmd = build_command(&options);
    assert!(cmd.contains("You are helpful"));
    assert!(cmd.contains("Review code"));
}

// Tool configuration tests
#[test]
fn test_qwen_tool_default_values() {
    let tool = QwenTool::default();
    assert_eq!(tool.name, "qwen");
    assert_eq!(tool.display_name, "Qwen Code CLI");
    assert_eq!(tool.executable, "qwen");
    assert_eq!(tool.default_model, "qwen3-coder-480a35");
    assert!(!tool.supports_system_prompt); // Combined with user prompt
}
