//! Agent CLI tool configuration (@link-assistant/agent).
//!
//! Based on hive-mind's agent.lib.mjs implementation.
//! Agent is a fork of OpenCode that ships a native, enforceable permission
//! system (agent v0.24.0, PR #272) exposed through `--permission-mode`
//! (auto | plan | readonly | ask) and an OpenCode-compatible `--permission`
//! JSON policy.

use crate::streaming::parse_ndjson;
use crate::tools::shell::{build_command_head, escape_arg, escape_single_quotes};
use serde_json::Value;
use std::collections::HashMap;

/// Get the Agent model map
/// Maps aliases to full model IDs (uses OpenCode's provider/model format)
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    // OpenCode Zen free models (current)
    map.insert("grok", "opencode/grok-code");
    map.insert("grok-code", "opencode/grok-code");
    map.insert("grok-code-fast-1", "opencode/grok-code");
    map.insert("big-pickle", "opencode/big-pickle");
    map.insert("gpt-5-nano", "opencode/gpt-5-nano");
    map.insert("minimax-m2.5-free", "opencode/minimax-m2.5-free");
    // Default: NVIDIA hybrid Mamba-Transformer (hive-mind issue #1563, agent PR #243)
    map.insert("nemotron-3-super-free", "opencode/nemotron-3-super-free");
    // Kilo Gateway free models
    map.insert("glm-5-free", "kilo/glm-5-free");
    map.insert("glm-4.5-air-free", "kilo/glm-4.5-air-free");
    map.insert("deepseek-r1-free", "kilo/deepseek-r1-free");
    map.insert("giga-potato-free", "kilo/giga-potato-free");
    map.insert("trinity-large-preview", "kilo/trinity-large-preview");
    // Deprecated free models (kept for backward compatibility)
    map.insert("qwen3.6-plus-free", "opencode/qwen3.6-plus-free"); // Deprecated: free promotion ended April 2026
    map.insert("kimi-k2.5-free", "opencode/kimi-k2.5-free");
    map.insert("glm-4.7-free", "opencode/glm-4.7-free");
    map.insert("minimax-m2.1-free", "opencode/minimax-m2.1-free");
    // Premium models
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
    model_map
        .get(model)
        .map(|s| s.to_string())
        .unwrap_or_else(|| model.to_string())
}

/// Agent command build options
#[derive(Debug, Clone, Default)]
pub struct AgentBuildOptions {
    pub prompt: Option<String>,
    pub prompt_file: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub compact_json: bool,
    pub use_existing_claude_oauth: bool,
    /// Enforce hard read-only mode (`--permission-mode readonly`)
    pub read_only: bool,
    /// Enforce planning mode (`--permission-mode plan`)
    pub plan_only: bool,
    /// Explicit agent permission mode (auto | plan | readonly | ask)
    pub permission_mode: Option<String>,
    /// OpenCode-compatible `--permission` JSON policy
    pub permission: Option<String>,
    pub executable: Option<String>,
    pub extra_env: Vec<(String, String)>,
    pub extra_args: Vec<String>,
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

    // Native, enforceable permission system (agent v0.24.0, PR #272).
    // --plan-only maps to `plan`, --read-only maps to the harder `readonly`,
    // matching agent's own distinction between the two modes.
    let resolved_permission_mode = options.permission_mode.clone().or_else(|| {
        if options.plan_only {
            Some("plan".to_string())
        } else if options.read_only {
            Some("readonly".to_string())
        } else {
            None
        }
    });
    if let Some(mode) = resolved_permission_mode {
        args.push("--permission-mode".to_string());
        args.push(mode);
    }

    if let Some(ref permission) = options.permission {
        args.push("--permission".to_string());
        args.push(permission.clone());
    }

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

    args.extend(options.extra_args.clone());

    args
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
    let input_command = options.prompt_file.as_ref().map_or_else(
        || format!("printf '%s' '{}'", escape_single_quotes(&combined_prompt)),
        |prompt_file| format!("cat {}", escape_arg(prompt_file)),
    );
    let executable = options.executable.as_deref().unwrap_or("agent");
    format!(
        "{} | {} {}",
        input_command,
        build_command_head(executable, &options.extra_env, &[]),
        args_str.join(" ")
    )
    .trim()
    .to_string()
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
                message: msg
                    .get("message")
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
    pub supports_read_only: bool,
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
            supports_resume: false,    // Agent doesn't have explicit resume like Claude
            supports_read_only: true, // Native --permission-mode readonly/plan (agent v0.24.0, PR #272)
            default_model: "nemotron-3-super-free", // hive-mind issue #1563, agent PR #243
        }
    }
}

// Tests are in rust/tests/agent_tests.rs
