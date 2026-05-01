//! Codex CLI tool configuration
//! Based on hive-mind's codex.lib.mjs implementation

use crate::streaming::parse_ndjson;
use crate::tools::shell::{build_command_head, escape_arg, escape_single_quotes};
use serde_json::Value;
use std::collections::HashMap;

/// Get the Codex model map
pub fn get_model_map() -> HashMap<&'static str, &'static str> {
    let mut map = HashMap::new();
    map.insert("gpt5", "gpt-5");
    map.insert("gpt-5", "gpt-5");
    map.insert("gpt5-codex", "gpt-5-codex");
    // GPT-5.5 family (hive-mind PR #1657, default)
    map.insert("gpt-5.5", "gpt-5.5");
    map.insert("gpt-5.5-mini", "gpt-5.5-mini");
    map.insert("gpt-5.5-nano", "gpt-5.5-nano");
    // GPT-5.4 family
    map.insert("gpt-5.4", "gpt-5.4");
    map.insert("gpt-5.4-mini", "gpt-5.4-mini");
    map.insert("gpt-5.4-nano", "gpt-5.4-nano");
    // GPT-5.3 family (codex variants)
    map.insert("gpt-5.3-codex", "gpt-5.3-codex");
    map.insert("gpt-5.3-codex-spark", "gpt-5.3-codex-spark");
    // GPT-5.2 family
    map.insert("gpt-5.2", "gpt-5.2");
    map.insert("gpt-5.2-codex", "gpt-5.2-codex");
    // GPT-5.1 family
    map.insert("gpt-5.1-codex-max", "gpt-5.1-codex-max");
    map.insert("o3", "o3");
    map.insert("o3-mini", "o3-mini");
    map.insert("gpt4", "gpt-4");
    map.insert("gpt-4", "gpt-4");
    map.insert("gpt4o", "gpt-4o");
    map.insert("gpt-4o", "gpt-4o");
    map.insert("claude", "claude-3-5-sonnet");
    map.insert("sonnet", "claude-3-5-sonnet");
    map.insert("opus", "claude-3-opus");
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

/// Codex command build options
#[derive(Debug, Clone, Default)]
pub struct CodexBuildOptions {
    pub prompt: Option<String>,
    pub prompt_file: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub json: bool,
    pub resume: Option<String>,
    pub read_only: bool,
    pub executable: Option<String>,
    pub extra_env: Vec<(String, String)>,
    pub extra_args: Vec<String>,
    pub skip_default_safety_flags: bool,
    pub sandbox_mode: Option<String>,
    pub approval_mode: Option<String>,
}

/// Build command line arguments for Codex
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Vector of CLI arguments
pub fn build_args(options: &CodexBuildOptions) -> Vec<String> {
    let mut args = vec!["exec".to_string()];

    if let Some(ref resume) = options.resume {
        args.push("resume".to_string());
        args.push(resume.clone());
    }

    if let Some(ref model) = options.model {
        let mapped_model = map_model_to_id(model);
        args.push("--model".to_string());
        args.push(mapped_model);
    }

    // Default to json=true like JavaScript version
    if options.json {
        args.push("--json".to_string());
    }

    // Codex-specific flags for autonomous execution
    args.push("--skip-git-repo-check".to_string());
    if options.read_only {
        args.push("--sandbox".to_string());
        args.push("read-only".to_string());
    } else if let Some(ref sandbox_mode) = options.sandbox_mode {
        args.push("--sandbox".to_string());
        args.push(sandbox_mode.clone());
    }

    if !options.read_only
        && options.sandbox_mode.is_none()
        && options.approval_mode.is_none()
        && !options.skip_default_safety_flags
    {
        args.push("--dangerously-bypass-approvals-and-sandbox".to_string());
    }

    args.extend(options.extra_args.clone());

    args
}

/// Build complete command string for Codex
/// Codex uses stdin for prompt input
///
/// # Arguments
/// * `options` - Build options
///
/// # Returns
/// Complete command string
pub fn build_command(options: &CodexBuildOptions) -> String {
    let args = build_args(options);
    let args_str: Vec<String> = args.iter().map(|a| escape_arg(a)).collect();

    // Codex expects prompt via stdin, combine system and user prompts
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
    let executable = options.executable.as_deref().unwrap_or("codex");
    let mut prefix_args = Vec::new();
    if options.read_only {
        prefix_args.push("--ask-for-approval".to_string());
        prefix_args.push("never".to_string());
    } else if let Some(ref approval_mode) = options.approval_mode {
        prefix_args.push("--ask-for-approval".to_string());
        prefix_args.push(approval_mode.clone());
    }

    format!(
        "{} | {} {}",
        input_command,
        build_command_head(executable, &options.extra_env, &prefix_args),
        args_str.join(" ")
    )
    .trim()
    .to_string()
}

/// Parse JSON messages from Codex output
/// Codex outputs NDJSON format
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Vector of parsed JSON messages
pub fn parse_output(output: &str) -> Vec<Value> {
    parse_ndjson(output)
}

/// Extract session/thread ID from Codex output
/// Codex uses thread_id instead of session_id
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Session ID or None
pub fn extract_session_id(output: &str) -> Option<String> {
    let messages = parse_output(output);

    for msg in messages {
        if let Some(thread_id) = msg.get("thread_id").and_then(|v| v.as_str()) {
            return Some(thread_id.to_string());
        }
        if let Some(session_id) = msg.get("session_id").and_then(|v| v.as_str()) {
            return Some(session_id.to_string());
        }
    }

    None
}

/// Usage statistics
#[derive(Debug, Clone, Default)]
pub struct CodexUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
}

/// Extract usage statistics from Codex output
///
/// # Arguments
/// * `output` - Raw output string
///
/// # Returns
/// Usage statistics
pub fn extract_usage(output: &str) -> CodexUsage {
    let messages = parse_output(output);
    let mut usage = CodexUsage::default();

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

/// Codex tool configuration
#[derive(Debug, Clone)]
pub struct CodexTool {
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

impl Default for CodexTool {
    fn default() -> Self {
        Self {
            name: "codex",
            display_name: "Codex CLI",
            executable: "codex",
            supports_json_output: true,
            supports_json_input: true, // Codex can accept JSON input via stdin
            supports_system_prompt: false, // System prompt is combined with user prompt
            supports_resume: true,
            supports_read_only: true, // Supports --sandbox read-only
            default_model: "gpt-5.5", // hive-mind PR #1657
        }
    }
}

// Tests are in rust/tests/codex_tests.rs
