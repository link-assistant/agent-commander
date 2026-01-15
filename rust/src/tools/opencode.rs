//! OpenCode CLI tool configuration
//! Based on hive-mind's opencode.lib.mjs implementation

use crate::streaming::parse_ndjson;
use serde_json::Value;
use std::collections::HashMap;

/// Get the OpenCode model map
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    map.insert("gpt4", "openai/gpt-4");
    map.insert("gpt4o", "openai/gpt-4o");
    map.insert("claude", "anthropic/claude-3-5-sonnet");
    map.insert("sonnet", "anthropic/claude-3-5-sonnet");
    map.insert("opus", "anthropic/claude-3-opus");
    map.insert("gemini", "google/gemini-pro");
    map.insert("grok", "opencode/grok-code");
    map.insert("grok-code", "opencode/grok-code");
    map.insert("grok-code-fast-1", "opencode/grok-code");
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

/// OpenCode command build options
#[derive(Debug, Clone, Default)]
pub struct OpencodeBuildOptions {
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub json: bool,
    pub resume: Option<String>,
}

/// Build command line arguments for OpenCode
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Vector of CLI arguments
pub fn build_args(options: &OpencodeBuildOptions) -> Vec<String> {
    let mut args = vec!["run".to_string()];

    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("--model".to_string());
        args.push(mapped_model);
    }

    // Default to json=true like JavaScript version
    if options.json {
        args.push("--format".to_string());
        args.push("json".to_string());
    }

    if let Some(ref resume) = options.resume {
        args.push("--resume".to_string());
        args.push(resume.clone());
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

/// Escape single quotes for printf
fn escape_single_quotes(s: &str) -> String {
    s.replace('\'', "'\\''")
}

/// Build complete command string for OpenCode
/// OpenCode uses stdin for prompt input
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Complete command string
pub fn build_command(options: &OpencodeBuildOptions) -> String {
    let args = build_args(options);
    let args_str: Vec<String> = args.iter().map(|a| escape_arg(a)).collect();

    // OpenCode expects prompt via stdin, combine system and user prompts
    let combined_prompt = match (&options.system_prompt, &options.prompt) {
        (Some(sys), Some(prompt)) => format!("{}\n\n{}", sys, prompt),
        (Some(sys), None) => sys.clone(),
        (None, Some(prompt)) => prompt.clone(),
        (None, None) => String::new(),
    };

    // Build command with stdin piping
    let escaped_prompt = escape_single_quotes(&combined_prompt);
    format!(
        "printf '%s' '{}' | opencode {}",
        escaped_prompt,
        args_str.join(" ")
    )
    .trim()
    .to_string()
}

/// Parse JSON messages from OpenCode output
/// OpenCode outputs NDJSON format
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Vector of parsed JSON messages
pub fn parse_output(output: &str) -> Vec<Value> {
    parse_ndjson(output)
}

/// Extract session ID from OpenCode output
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
    }

    None
}

/// Usage statistics
#[derive(Debug, Clone, Default)]
pub struct OpencodeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Extract usage statistics from OpenCode output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Usage statistics
pub fn extract_usage(output: &str) -> OpencodeUsage {
    let messages = parse_output(output);
    let mut usage = OpencodeUsage::default();

    for msg in messages {
        if let Some(msg_usage) = msg.get("usage") {
            if let Some(input) = msg_usage.get("input_tokens").and_then(|v| v.as_u64()) {
                usage.input_tokens += input;
            }
            if let Some(output) = msg_usage.get("output_tokens").and_then(|v| v.as_u64()) {
                usage.output_tokens += output;
            }
        }
    }

    usage
}

/// OpenCode tool configuration
#[derive(Debug, Clone)]
pub struct OpencodeTool {
    pub name: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub supports_json_output: bool,
    pub supports_json_input: bool,
    pub supports_system_prompt: bool,
    pub supports_resume: bool,
    pub default_model: &'static str,
}

impl Default for OpencodeTool {
    fn default() -> Self {
        Self {
            name: "opencode",
            display_name: "OpenCode CLI",
            executable: "opencode",
            supports_json_output: true,
            supports_json_input: true, // OpenCode can accept JSON input via stdin
            supports_system_prompt: false, // System prompt is combined with user prompt
            supports_resume: true,
            default_model: "grok-code-fast-1",
        }
    }
}

// Tests are in rust/tests/opencode_tests.rs
