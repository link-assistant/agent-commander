//! Claude CLI tool configuration
//! Based on hive-mind's claude.lib.mjs implementation

use std::collections::HashMap;
use serde_json::Value;
use crate::streaming::parse_ndjson;

/// Get the Claude model map
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    map.insert("sonnet", "claude-sonnet-4-5-20250929");
    map.insert("opus", "claude-opus-4-5-20251101");
    map.insert("haiku", "claude-haiku-4-5-20251001");
    map.insert("haiku-3-5", "claude-3-5-haiku-20241022");
    map.insert("haiku-3", "claude-3-haiku-20240307");
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
    model_map.get(model)
        .map(|s| s.to_string())
        .unwrap_or_else(|| model.to_string())
}

/// Claude command build options
#[derive(Debug, Clone, Default)]
pub struct ClaudeBuildOptions {
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub print: bool,
    pub json: bool,
    pub resume: Option<String>,
}

/// Build command line arguments for Claude
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Vector of CLI arguments
pub fn build_args(options: &ClaudeBuildOptions) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("--model".to_string());
        args.push(mapped_model);
    }

    if let Some(ref prompt) = options.prompt {
        args.push("--prompt".to_string());
        args.push(prompt.clone());
    }

    if let Some(ref system_prompt) = options.system_prompt {
        args.push("--system-prompt".to_string());
        args.push(system_prompt.clone());
    }

    if options.print {
        args.push("-p".to_string()); // Print mode
    }

    if options.json {
        args.push("--output-format".to_string());
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
    if arg.contains('"') || arg.contains(char::is_whitespace) || arg.contains('$') ||
       arg.contains('`') || arg.contains('\\') {
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

/// Build complete command string for Claude
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Complete command string
pub fn build_command(options: &ClaudeBuildOptions) -> String {
    let args = build_args(options);
    let args_str: Vec<String> = args.iter().map(|a| escape_arg(a)).collect();
    format!("claude {}", args_str.join(" ")).trim().to_string()
}

/// Parse JSON messages from Claude output
/// Claude outputs NDJSON (newline-delimited JSON) in JSON mode
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Vector of parsed JSON messages
pub fn parse_output(output: &str) -> Vec<Value> {
    parse_ndjson(output)
}

/// Extract session ID from Claude output
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
pub struct ClaudeUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_creation_tokens: u64,
    pub cache_read_tokens: u64,
}

/// Extract usage statistics from Claude output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Usage statistics
pub fn extract_usage(output: &str) -> ClaudeUsage {
    let messages = parse_output(output);
    let mut usage = ClaudeUsage::default();

    for msg in messages {
        if let Some(msg_usage) = msg.get("message").and_then(|m| m.get("usage")) {
            if let Some(input) = msg_usage.get("input_tokens").and_then(|v| v.as_u64()) {
                usage.input_tokens += input;
            }
            if let Some(output) = msg_usage.get("output_tokens").and_then(|v| v.as_u64()) {
                usage.output_tokens += output;
            }
            if let Some(cache_creation) = msg_usage.get("cache_creation_input_tokens").and_then(|v| v.as_u64()) {
                usage.cache_creation_tokens += cache_creation;
            }
            if let Some(cache_read) = msg_usage.get("cache_read_input_tokens").and_then(|v| v.as_u64()) {
                usage.cache_read_tokens += cache_read;
            }
        }
    }

    usage
}

/// Claude tool configuration
#[derive(Debug, Clone)]
pub struct ClaudeTool {
    pub name: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub supports_json_output: bool,
    pub supports_json_input: bool,
    pub supports_system_prompt: bool,
    pub supports_resume: bool,
    pub default_model: &'static str,
}

impl Default for ClaudeTool {
    fn default() -> Self {
        Self {
            name: "claude",
            display_name: "Claude Code CLI",
            executable: "claude",
            supports_json_output: true,
            supports_json_input: false, // Claude doesn't support JSON streaming input yet
            supports_system_prompt: true,
            supports_resume: true,
            default_model: "sonnet",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_model_to_id_with_alias() {
        assert_eq!(map_model_to_id("sonnet"), "claude-sonnet-4-5-20250929");
        assert_eq!(map_model_to_id("opus"), "claude-opus-4-5-20251101");
        assert_eq!(map_model_to_id("haiku"), "claude-haiku-4-5-20251001");
    }

    #[test]
    fn test_map_model_to_id_with_full_id() {
        assert_eq!(map_model_to_id("claude-3-opus-20240229"), "claude-3-opus-20240229");
    }

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
}
