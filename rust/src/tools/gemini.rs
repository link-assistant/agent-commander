//! Gemini CLI tool configuration
//! Based on Google's official gemini-cli: https://github.com/google-gemini/gemini-cli

use crate::streaming::parse_ndjson;
use serde_json::Value;
use std::collections::HashMap;

/// Get the Gemini model map
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    // Gemini 2.5 models (current stable)
    map.insert("flash", "gemini-2.5-flash");
    map.insert("2.5-flash", "gemini-2.5-flash");
    map.insert("pro", "gemini-2.5-pro");
    map.insert("2.5-pro", "gemini-2.5-pro");
    map.insert("lite", "gemini-2.5-flash-lite");
    map.insert("2.5-lite", "gemini-2.5-flash-lite");
    // Gemini 3 models (latest generation)
    map.insert("3-flash", "gemini-3-flash-preview");
    map.insert("3-pro", "gemini-3-pro-preview");
    // Legacy aliases
    map.insert("gemini-flash", "gemini-2.5-flash");
    map.insert("gemini-pro", "gemini-2.5-pro");
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

/// Gemini command build options
#[derive(Debug, Clone, Default)]
pub struct GeminiBuildOptions {
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub json: bool,
    pub yolo: bool,
    pub sandbox: bool,
    pub debug: bool,
    pub checkpointing: bool,
    pub interactive: bool,
}

impl GeminiBuildOptions {
    /// Create new options with yolo enabled by default (for autonomous agent use)
    pub fn new() -> Self {
        Self {
            yolo: true,
            ..Default::default()
        }
    }
}

/// Build command line arguments for Gemini CLI
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Vector of CLI arguments
pub fn build_args(options: &GeminiBuildOptions) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("-m".to_string());
        args.push(mapped_model);
    }

    // Enable yolo mode for autonomous execution (auto-approve all tool calls)
    if options.yolo {
        args.push("--yolo".to_string());
    }

    // Sandbox mode for secure execution
    if options.sandbox {
        args.push("--sandbox".to_string());
    }

    // Debug output
    if options.debug {
        args.push("-d".to_string());
    }

    // Checkpointing for file modifications
    if options.checkpointing {
        args.push("--checkpointing".to_string());
    }

    // JSON output mode - use stream-json for streaming events
    if options.json {
        args.push("--output-format".to_string());
        args.push("stream-json".to_string());
    }

    // Add prompt for non-interactive mode
    if let Some(ref prompt) = options.prompt {
        if options.interactive {
            args.push("-i".to_string());
        } else {
            args.push("-p".to_string());
        }
        args.push(prompt.clone());
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

/// Build complete command string for Gemini CLI
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Complete command string
pub fn build_command(options: &GeminiBuildOptions) -> String {
    // Gemini CLI supports system prompt via GEMINI_SYSTEM_PROMPT env var
    // or via .gemini/system.md file. For now, combine with user prompt.
    let combined_prompt = match (&options.system_prompt, &options.prompt) {
        (Some(sys), Some(prompt)) => Some(format!("{}\n\n{}", sys, prompt)),
        (Some(sys), None) => Some(sys.clone()),
        (None, Some(prompt)) => Some(prompt.clone()),
        (None, None) => None,
    };

    let modified_options = GeminiBuildOptions {
        prompt: combined_prompt,
        system_prompt: None,
        ..options.clone()
    };

    let args = build_args(&modified_options);
    let args_str: Vec<String> = args.iter().map(|a| escape_arg(a)).collect();
    format!("gemini {}", args_str.join(" ")).trim().to_string()
}

/// Parse JSON messages from Gemini CLI output
/// Gemini CLI outputs NDJSON (newline-delimited JSON) in stream-json mode
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Vector of parsed JSON messages
pub fn parse_output(output: &str) -> Vec<Value> {
    parse_ndjson(output)
}

/// Extract session ID from Gemini CLI output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Session ID or None
pub fn extract_session_id(output: &str) -> Option<String> {
    let messages = parse_output(output);

    for msg in messages {
        if let Some(session_id) = msg.get("session_id").and_then(|v| v.as_str()) {
            return Some(session_id.to_string());
        }
        // Gemini might use different session identifier
        if let Some(conv_id) = msg.get("conversation_id").and_then(|v| v.as_str()) {
            return Some(conv_id.to_string());
        }
    }

    None
}

/// Usage statistics
#[derive(Debug, Clone, Default)]
pub struct GeminiUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub total_tokens: u64,
}

/// Extract usage statistics from Gemini CLI output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Usage statistics
pub fn extract_usage(output: &str) -> GeminiUsage {
    let messages = parse_output(output);
    let mut usage = GeminiUsage::default();

    for msg in messages {
        // Check for usage metadata in different possible formats
        if let Some(msg_usage) = msg.get("usage") {
            if let Some(input) = msg_usage.get("input_tokens").and_then(|v| v.as_u64()) {
                usage.input_tokens += input;
            }
            if let Some(output_val) = msg_usage.get("output_tokens").and_then(|v| v.as_u64()) {
                usage.output_tokens += output_val;
            }
            if let Some(total) = msg_usage.get("total_tokens").and_then(|v| v.as_u64()) {
                usage.total_tokens += total;
            }
            // Also check camelCase variants
            if let Some(input) = msg_usage.get("inputTokens").and_then(|v| v.as_u64()) {
                usage.input_tokens += input;
            }
            if let Some(output_val) = msg_usage.get("outputTokens").and_then(|v| v.as_u64()) {
                usage.output_tokens += output_val;
            }
            if let Some(total) = msg_usage.get("totalTokens").and_then(|v| v.as_u64()) {
                usage.total_tokens += total;
            }
        }

        // Also check for Gemini-specific token metrics
        if let Some(usage_meta) = msg.get("usageMetadata") {
            if let Some(prompt) = usage_meta.get("promptTokenCount").and_then(|v| v.as_u64()) {
                usage.input_tokens += prompt;
            }
            if let Some(candidates) = usage_meta
                .get("candidatesTokenCount")
                .and_then(|v| v.as_u64())
            {
                usage.output_tokens += candidates;
            }
            if let Some(total) = usage_meta.get("totalTokenCount").and_then(|v| v.as_u64()) {
                usage.total_tokens += total;
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
#[derive(Debug, Clone, Default)]
pub struct GeminiErrorResult {
    pub has_error: bool,
    pub error_type: Option<String>,
    pub message: Option<String>,
}

/// Detect errors in Gemini CLI output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Error detection result
pub fn detect_errors(output: &str) -> GeminiErrorResult {
    let messages = parse_output(output);

    for msg in messages {
        // Check for explicit error message types
        let is_error =
            msg.get("type").and_then(|v| v.as_str()) == Some("error") || msg.get("error").is_some();

        if is_error {
            let error_type = msg
                .get("type")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| Some("error".to_string()));

            let message = msg
                .get("message")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
                .or_else(|| {
                    msg.get("error")
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                })
                .or_else(|| Some("Unknown error".to_string()));

            return GeminiErrorResult {
                has_error: true,
                error_type,
                message,
            };
        }
    }

    GeminiErrorResult::default()
}

/// Gemini CLI tool configuration
#[derive(Debug, Clone)]
pub struct GeminiTool {
    pub name: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub supports_json_output: bool,
    pub supports_json_input: bool,
    pub supports_system_prompt: bool,
    pub supports_resume: bool,
    pub supports_yolo: bool,
    pub supports_sandbox: bool,
    pub supports_checkpointing: bool,
    pub supports_debug: bool,
    pub default_model: &'static str,
}

impl Default for GeminiTool {
    fn default() -> Self {
        Self {
            name: "gemini",
            display_name: "Gemini CLI",
            executable: "gemini",
            supports_json_output: true,
            supports_json_input: false, // Gemini CLI uses -p flag for prompts, not stdin JSON
            supports_system_prompt: false, // System prompt via env var or file, combined with user
            supports_resume: true,      // Via /chat resume command in interactive mode
            supports_yolo: true,        // Supports --yolo for autonomous execution
            supports_sandbox: true,     // Supports --sandbox for secure execution
            supports_checkpointing: true, // Supports --checkpointing
            supports_debug: true,       // Supports -d for debug output
            default_model: "gemini-2.5-flash",
        }
    }
}

// Tests are in rust/tests/gemini_tests.rs
