//! Claude CLI tool configuration
//! Based on hive-mind's claude.lib.mjs implementation

use crate::streaming::parse_ndjson;
use serde_json::Value;
use std::collections::HashMap;

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
    model_map
        .get(model)
        .map(|s| s.to_string())
        .unwrap_or_else(|| model.to_string())
}

/// Claude command build options
#[derive(Debug, Clone, Default)]
pub struct ClaudeBuildOptions {
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub append_system_prompt: Option<String>,
    pub model: Option<String>,
    pub fallback_model: Option<String>,
    pub print: bool,
    pub verbose: bool,
    pub json: bool,
    pub json_input: bool,
    pub replay_user_messages: bool,
    pub resume: Option<String>,
    pub session_id: Option<String>,
    pub fork_session: bool,
    // Note: dangerously_skip_permissions is always enabled and not configurable (per issue #3)
}

impl ClaudeBuildOptions {
    /// Create new options
    pub fn new() -> Self {
        Self::default()
    }
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

    // Permission bypass - always enabled, not configurable (per issue #3)
    args.push("--dangerously-skip-permissions".to_string());

    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("--model".to_string());
        args.push(mapped_model);
    }

    if let Some(ref fallback_model) = options.fallback_model {
        let mapped_fallback = map_model_to_id(fallback_model);
        args.push("--fallback-model".to_string());
        args.push(mapped_fallback);
    }

    if let Some(ref prompt) = options.prompt {
        args.push("--prompt".to_string());
        args.push(prompt.clone());
    }

    if let Some(ref system_prompt) = options.system_prompt {
        args.push("--system-prompt".to_string());
        args.push(system_prompt.clone());
    }

    if let Some(ref append_system_prompt) = options.append_system_prompt {
        args.push("--append-system-prompt".to_string());
        args.push(append_system_prompt.clone());
    }

    if options.verbose {
        args.push("--verbose".to_string());
    }

    if options.print {
        args.push("-p".to_string()); // Print mode
    }

    // JSON output mode - use stream-json format per issue #3
    if options.json {
        args.push("--output-format".to_string());
        args.push("stream-json".to_string());
    }

    // JSON input mode - use stream-json format per issue #3
    if options.json_input {
        args.push("--input-format".to_string());
        args.push("stream-json".to_string());
    }

    // Replay user messages (only with stream-json input/output)
    if options.replay_user_messages {
        args.push("--replay-user-messages".to_string());
    }

    // Session management
    if let Some(ref session_id) = options.session_id {
        args.push("--session-id".to_string());
        args.push(session_id.clone());
    }

    if let Some(ref resume) = options.resume {
        args.push("--resume".to_string());
        args.push(resume.clone());
    }

    if options.fork_session {
        args.push("--fork-session".to_string());
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
            if let Some(cache_creation) = msg_usage
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
            {
                usage.cache_creation_tokens += cache_creation;
            }
            if let Some(cache_read) = msg_usage
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
            {
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
    pub supports_append_system_prompt: bool,
    pub supports_resume: bool,
    pub supports_fork_session: bool,
    pub supports_session_id: bool,
    pub supports_fallback_model: bool,
    pub supports_verbose: bool,
    pub supports_replay_user_messages: bool,
    pub default_model: &'static str,
}

impl Default for ClaudeTool {
    fn default() -> Self {
        Self {
            name: "claude",
            display_name: "Claude Code CLI",
            executable: "claude",
            supports_json_output: true,
            supports_json_input: true, // Claude supports stream-json input format
            supports_system_prompt: true,
            supports_append_system_prompt: true, // Supports --append-system-prompt
            supports_resume: true,
            supports_fork_session: true,   // Supports --fork-session
            supports_session_id: true,     // Supports --session-id
            supports_fallback_model: true, // Supports --fallback-model
            supports_verbose: true,        // Supports --verbose
            supports_replay_user_messages: true, // Supports --replay-user-messages
            default_model: "sonnet",
        }
    }
}

// Tests are in rust/tests/claude_tests.rs
