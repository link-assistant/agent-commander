//! Agent CLI tool configuration (@link-assistant/agent)
//! Based on hive-mind's agent.lib.mjs implementation
//! Agent is a fork of OpenCode with unrestricted permissions for autonomous execution

use std::collections::HashMap;
use serde_json::Value;
use crate::streaming::parse_ndjson;

/// Get the Agent model map
/// Maps aliases to full model IDs (uses OpenCode's provider/model format)
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    map.insert("grok", "opencode/grok-code");
    map.insert("grok-code", "opencode/grok-code");
    map.insert("grok-code-fast-1", "opencode/grok-code");
    map.insert("big-pickle", "opencode/big-pickle");
    map.insert("gpt-5-nano", "openai/gpt-5-nano");
    map.insert("sonnet", "anthropic/claude-3-5-sonnet");
    map.insert("haiku", "anthropic/claude-3-5-haiku");
    map.insert("opus", "anthropic/claude-3-opus");
    map.insert("gemini-3-pro", "google/gemini-3-pro");
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

/// Agent command build options
#[derive(Debug, Clone, Default)]
pub struct AgentBuildOptions {
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub compact_json: bool,
    pub use_existing_claude_oauth: bool,
}

/// Build command line arguments for Agent
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Vector of CLI arguments
pub fn build_args(options: &AgentBuildOptions) -> Vec<String> {
    let mut args = Vec::new();

    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("--model".to_string());
        args.push(mapped_model);
    }

    if options.compact_json {
        args.push("--compact-json".to_string());
    }

    if options.use_existing_claude_oauth {
        args.push("--use-existing-claude-oauth".to_string());
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

/// Escape single quotes for printf
fn escape_single_quotes(s: &str) -> String {
    s.replace('\'', "'\\''")
}

/// Build complete command string for Agent
/// Agent uses stdin for prompt input (NDJSON streaming supported)
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Complete command string
pub fn build_command(options: &AgentBuildOptions) -> String {
    let args = build_args(options);
    let args_str: Vec<String> = args.iter().map(|a| escape_arg(a)).collect();

    // Agent expects prompt via stdin, combine system and user prompts
    let combined_prompt = match (&options.system_prompt, &options.prompt) {
        (Some(sys), Some(prompt)) => format!("{}\n\n{}", sys, prompt),
        (Some(sys), None) => sys.clone(),
        (None, Some(prompt)) => prompt.clone(),
        (None, None) => String::new(),
    };

    // Build command with stdin piping
    let escaped_prompt = escape_single_quotes(&combined_prompt);
    format!("printf '%s' '{}' | agent {}", escaped_prompt, args_str.join(" ")).trim().to_string()
}

/// Parse JSON messages from Agent output
/// Agent outputs NDJSON format with specific event types
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Vector of parsed JSON messages
pub fn parse_output(output: &str) -> Vec<Value> {
    parse_ndjson(output)
}

/// Extract session ID from Agent output
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

/// Usage statistics for Agent
#[derive(Debug, Clone, Default)]
pub struct AgentUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub reasoning_tokens: u64,
    pub cache_read_tokens: u64,
    pub cache_write_tokens: u64,
    pub total_cost: f64,
    pub step_count: u64,
}

/// Parse token usage from Agent output
/// Agent outputs step_finish events with token data
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Token usage statistics
pub fn extract_usage(output: &str) -> AgentUsage {
    let messages = parse_output(output);
    let mut usage = AgentUsage::default();

    for msg in messages {
        // Look for step_finish events which contain token usage
        if msg.get("type").and_then(|t| t.as_str()) == Some("step_finish") {
            if let Some(part) = msg.get("part") {
                usage.step_count += 1;

                if let Some(tokens) = part.get("tokens") {
                    if let Some(input) = tokens.get("input").and_then(|v| v.as_u64()) {
                        usage.input_tokens += input;
                    }
                    if let Some(output) = tokens.get("output").and_then(|v| v.as_u64()) {
                        usage.output_tokens += output;
                    }
                    if let Some(reasoning) = tokens.get("reasoning").and_then(|v| v.as_u64()) {
                        usage.reasoning_tokens += reasoning;
                    }

                    // Handle cache tokens
                    if let Some(cache) = tokens.get("cache") {
                        if let Some(read) = cache.get("read").and_then(|v| v.as_u64()) {
                            usage.cache_read_tokens += read;
                        }
                        if let Some(write) = cache.get("write").and_then(|v| v.as_u64()) {
                            usage.cache_write_tokens += write;
                        }
                    }
                }

                // Add cost from step_finish
                if let Some(cost) = part.get("cost").and_then(|v| v.as_f64()) {
                    usage.total_cost += cost;
                }
            }
        }
    }

    usage
}

/// Error detection result
#[derive(Debug, Clone, Default)]
pub struct ErrorResult {
    pub has_error: bool,
    pub error_type: Option<String>,
    pub message: Option<String>,
}

/// Detect errors in Agent output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Error detection result
pub fn detect_errors(output: &str) -> ErrorResult {
    let messages = parse_output(output);

    for msg in messages {
        // Check for explicit error message types from agent
        let msg_type = msg.get("type").and_then(|t| t.as_str());
        if msg_type == Some("error") || msg_type == Some("step_error") {
            return ErrorResult {
                has_error: true,
                error_type: msg_type.map(|s| s.to_string()),
                message: msg.get("message")
                    .and_then(|m| m.as_str())
                    .map(|s| s.to_string())
                    .or_else(|| Some("Unknown error".to_string())),
            };
        }
    }

    ErrorResult::default()
}

/// Agent tool configuration
#[derive(Debug, Clone)]
pub struct AgentTool {
    pub name: &'static str,
    pub display_name: &'static str,
    pub executable: &'static str,
    pub supports_json_output: bool,
    pub supports_json_input: bool,
    pub supports_system_prompt: bool,
    pub supports_resume: bool,
    pub default_model: &'static str,
}

impl Default for AgentTool {
    fn default() -> Self {
        Self {
            name: "agent",
            display_name: "@link-assistant/agent",
            executable: "agent",
            supports_json_output: true,
            supports_json_input: true, // Agent supports full JSON streaming input
            supports_system_prompt: false, // System prompt is combined with user prompt
            supports_resume: false, // Agent doesn't have explicit resume like Claude
            default_model: "grok-code-fast-1",
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_map_model_to_id_with_alias() {
        assert_eq!(map_model_to_id("grok"), "opencode/grok-code");
        assert_eq!(map_model_to_id("sonnet"), "anthropic/claude-3-5-sonnet");
    }

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
    fn test_extract_usage_from_step_finish() {
        let output = r#"{"type":"step_finish","part":{"tokens":{"input":100,"output":50},"cost":0}}
{"type":"step_finish","part":{"tokens":{"input":200,"output":75},"cost":0}}"#;
        let usage = extract_usage(output);
        assert_eq!(usage.input_tokens, 300);
        assert_eq!(usage.output_tokens, 125);
        assert_eq!(usage.step_count, 2);
    }

    #[test]
    fn test_detect_errors_finds_error() {
        let output = r#"{"type":"error","message":"Something went wrong"}"#;
        let result = detect_errors(output);
        assert!(result.has_error);
        assert_eq!(result.error_type, Some("error".to_string()));
    }

    #[test]
    fn test_detect_errors_normal_output() {
        let output = r#"{"type":"step_finish","part":{}}"#;
        let result = detect_errors(output);
        assert!(!result.has_error);
    }
}
