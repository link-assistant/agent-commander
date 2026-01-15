//! Qwen Code CLI tool configuration
//! Based on https://github.com/QwenLM/qwen-code
//! Qwen Code is an open-source AI agent optimized for Qwen3-Coder models

use crate::streaming::parse_ndjson;
use serde_json::Value;
use std::collections::HashMap;

/// Get the Qwen model map
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    map.insert("qwen3-coder", "qwen3-coder-480a35");
    map.insert("qwen3-coder-480a35", "qwen3-coder-480a35");
    map.insert("qwen3-coder-30ba3", "qwen3-coder-30ba3");
    map.insert("coder", "qwen3-coder-480a35");
    map.insert("gpt-4o", "gpt-4o");
    map.insert("gpt-4", "gpt-4");
    map.insert("sonnet", "claude-sonnet-4");
    map.insert("opus", "claude-opus-4");
    map
}

/// Map model alias to full model ID
///
/// # Arguments
/// * `model` - Model alias or full ID
///
/// # Returns
/// Full model ID
pub fn map_model_to_id(model: &str) -> String {
    let model_map = get_model_map();
    model_map
        .get(model)
        .map(|s| s.to_string())
        .unwrap_or_else(|| model.to_string())
}

/// Qwen command build options
#[derive(Debug, Clone, Default)]
pub struct QwenBuildOptions {
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub json: bool,
    pub stream_json: bool,
    pub include_partial_messages: bool,
    pub yolo: bool,
    pub resume: Option<String>,
    pub continue_session: bool,
    pub all_files: bool,
    pub include_directories: Vec<String>,
}

impl QwenBuildOptions {
    /// Create new options with sensible defaults
    pub fn new() -> Self {
        Self {
            stream_json: true, // Default to stream-json
            yolo: true,        // Default to auto-approval
            ..Default::default()
        }
    }
}

/// Build command line arguments for Qwen Code
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Vector of CLI arguments
pub fn build_args(options: &QwenBuildOptions) -> Vec<String> {
    let mut args = Vec::new();

    // Prompt (triggers headless mode)
    if let Some(ref prompt) = options.prompt {
        args.push("-p".to_string());
        args.push(prompt.clone());
    }

    // Model configuration
    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("--model".to_string());
        args.push(mapped_model);
    }

    // Output format - prefer stream-json for real-time streaming
    if options.stream_json {
        args.push("--output-format".to_string());
        args.push("stream-json".to_string());
    } else if options.json {
        args.push("--output-format".to_string());
        args.push("json".to_string());
    }

    // Include partial messages for real-time UI updates
    if options.include_partial_messages && options.stream_json {
        args.push("--include-partial-messages".to_string());
    }

    // Auto-approve all actions for autonomous execution
    if options.yolo {
        args.push("--yolo".to_string());
    }

    // Session management
    if let Some(ref resume) = options.resume {
        args.push("--resume".to_string());
        args.push(resume.clone());
    } else if options.continue_session {
        args.push("--continue".to_string());
    }

    // Context options
    if options.all_files {
        args.push("--all-files".to_string());
    }

    for dir in &options.include_directories {
        args.push("--include-directories".to_string());
        args.push(dir.clone());
    }

    args
}

/// Escape an argument for shell usage
fn escape_arg(arg: &str) -> String {
    if arg.contains('"')
        || arg.contains(char::is_whitespace)
        || arg.contains('$')
        || arg.contains('`')
        || arg.contains('\\')
    {
        let escaped = arg
            .replace('\\', "\\\\")
            .replace('"', "\\\"")
            .replace('$', "\\$")
            .replace('`', "\\`");
        format!("\"{}\"", escaped)
    } else {
        arg.to_string()
    }
}

/// Build complete command string for Qwen Code
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Complete command string
pub fn build_command(options: &QwenBuildOptions) -> String {
    // Create a modified options with combined prompts
    let mut combined_options = options.clone();

    // Combine system prompt with user prompt if provided
    match (&options.system_prompt, &options.prompt) {
        (Some(sys), Some(prompt)) => {
            combined_options.prompt = Some(format!("{}\n\n{}", sys, prompt));
        }
        (Some(sys), None) => {
            combined_options.prompt = Some(sys.clone());
        }
        _ => {}
    }
    combined_options.system_prompt = None;

    let args = build_args(&combined_options);
    let args_str: Vec<String> = args.iter().map(|a| escape_arg(a)).collect();
    format!("qwen {}", args_str.join(" ")).trim().to_string()
}

/// Parse JSON messages from Qwen Code output
/// Qwen Code outputs NDJSON (newline-delimited JSON) in stream-json mode
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Vector of parsed JSON messages
pub fn parse_output(output: &str) -> Vec<Value> {
    parse_ndjson(output)
}

/// Extract session ID from Qwen Code output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Session ID or None
pub fn extract_session_id(output: &str) -> Option<String> {
    let messages = parse_output(output);

    for msg in messages {
        // Check for session_id format
        if let Some(session_id) = msg.get("session_id").and_then(|v| v.as_str()) {
            return Some(session_id.to_string());
        }
        // Also check for sessionId format
        if let Some(session_id) = msg.get("sessionId").and_then(|v| v.as_str()) {
            return Some(session_id.to_string());
        }
    }

    None
}

/// Usage statistics for Qwen Code
#[derive(Debug, Clone, Default)]
pub struct QwenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

/// Extract usage statistics from Qwen Code output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Usage statistics
pub fn extract_usage(output: &str) -> QwenUsage {
    let messages = parse_output(output);
    let mut usage = QwenUsage::default();

    for msg in messages {
        // Check for usage in message
        if let Some(msg_usage) = msg.get("usage") {
            if let Some(input) = msg_usage.get("input_tokens").and_then(|v| v.as_u64()) {
                usage.input_tokens += input;
            }
            if let Some(output_tokens) = msg_usage.get("output_tokens").and_then(|v| v.as_u64()) {
                usage.output_tokens += output_tokens;
            }
            if let Some(total) = msg_usage.get("total_tokens").and_then(|v| v.as_u64()) {
                usage.total_tokens += total;
            }
        }

        // Check for usage in result message
        if let Some(result) = msg.get("result") {
            if let Some(result_usage) = result.get("usage") {
                if let Some(input) = result_usage.get("input_tokens").and_then(|v| v.as_u64()) {
                    usage.input_tokens += input;
                }
                if let Some(output_tokens) =
                    result_usage.get("output_tokens").and_then(|v| v.as_u64())
                {
                    usage.output_tokens += output_tokens;
                }
                if let Some(total) = result_usage.get("total_tokens").and_then(|v| v.as_u64()) {
                    usage.total_tokens += total;
                }
            }
        }
    }

    // Calculate total if not provided
    if usage.total_tokens == 0 && (usage.input_tokens > 0 || usage.output_tokens > 0) {
        usage.total_tokens = usage.input_tokens + usage.output_tokens;
    }

    usage
}

/// Error detection result
#[derive(Debug, Clone)]
pub struct QwenErrorResult {
    pub has_error: bool,
    pub error_type: Option<String>,
    pub message: Option<String>,
}

impl Default for QwenErrorResult {
    fn default() -> Self {
        Self {
            has_error: false,
            error_type: None,
            message: None,
        }
    }
}

/// Detect errors in Qwen Code output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Error detection result
pub fn detect_errors(output: &str) -> QwenErrorResult {
    let messages = parse_output(output);

    for msg in messages {
        // Check for type: "error"
        if let Some(msg_type) = msg.get("type").and_then(|v| v.as_str()) {
            if msg_type == "error" {
                return QwenErrorResult {
                    has_error: true,
                    error_type: Some(msg_type.to_string()),
                    message: msg
                        .get("message")
                        .and_then(|v| v.as_str())
                        .or_else(|| msg.get("error").and_then(|v| v.as_str()))
                        .map(|s| s.to_string())
                        .or_else(|| Some("Unknown error".to_string())),
                };
            }
        }

        // Check for error field
        if let Some(error) = msg.get("error").and_then(|v| v.as_str()) {
            return QwenErrorResult {
                has_error: true,
                error_type: Some("error".to_string()),
                message: Some(error.to_string()),
            };
        }
    }

    QwenErrorResult::default()
}

/// Qwen Code tool configuration
#[derive(Debug, Clone)]
pub struct QwenTool {
    pub name: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub supports_json_output: bool,
    pub supports_json_input: bool,
    pub supports_system_prompt: bool,
    pub supports_resume: bool,
    pub supports_continue_session: bool,
    pub supports_yolo: bool,
    pub supports_all_files: bool,
    pub supports_include_directories: bool,
    pub supports_include_partial_messages: bool,
    pub default_model: &'static str,
}

impl Default for QwenTool {
    fn default() -> Self {
        Self {
            name: "qwen",
            display_name: "Qwen Code CLI",
            executable: "qwen",
            supports_json_output: true,
            supports_json_input: true, // Qwen Code supports stream-json input format
            supports_system_prompt: false, // System prompt is combined with user prompt
            supports_resume: true,     // Supports --resume and --continue
            supports_continue_session: true, // Supports --continue for most recent session
            supports_yolo: true,       // Supports --yolo for auto-approval
            supports_all_files: true,  // Supports --all-files
            supports_include_directories: true, // Supports --include-directories
            supports_include_partial_messages: true, // Supports --include-partial-messages
            default_model: "qwen3-coder-480a35",
        }
    }
}
