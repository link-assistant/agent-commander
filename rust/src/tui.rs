//! Interactive terminal launch and capture for supported agent clients.

use crate::tools::{agent, claude, codex, gemini, opencode, qwen};
use command_stream::terminal::{
    capture_terminal, TerminalCapture, TerminalCaptureError, TerminalCaptureOptions,
    TerminalInteraction, TerminalKey,
};
use std::collections::HashMap;
use std::path::PathBuf;
use std::time::Duration;
use thiserror::Error;

const READ_ONLY_OPENCODE_PERMISSION: &str = r#"{"edit":"deny","bash":"deny","task":"deny"}"#;
const SUPPORTED_TOOLS: [&str; 6] = ["claude", "codex", "opencode", "agent", "gemini", "qwen"];

/// Options for launching and driving an agent's real interactive terminal UI.
#[derive(Debug, Clone)]
pub struct AgentTuiOptions {
    /// Agent CLI name.
    pub tool: String,
    /// Directory in which the agent runs.
    pub working_directory: PathBuf,
    /// Override for the agent executable.
    pub executable: Option<String>,
    /// Arguments inserted before the generated agent arguments.
    pub prefix_args: Vec<String>,
    /// Additional agent arguments.
    pub extra_args: Vec<String>,
    /// Additional environment variables.
    pub extra_env: HashMap<String, String>,
    /// Optional model name or alias.
    pub model: Option<String>,
    /// Initial user prompt.
    pub prompt: Option<String>,
    /// Optional system prompt.
    pub system_prompt: Option<String>,
    /// Marker that must be observed before sending the initial prompt.
    pub prompt_after: Option<String>,
    /// Control key sent after the initial prompt.
    pub prompt_key: TerminalKey,
    /// Session identifier to resume.
    pub resume: Option<String>,
    /// Request the client's native read-only mode.
    pub read_only: bool,
    /// Request the client's native plan-only mode where distinct.
    pub plan_only: bool,
    /// Request approval for individual operations.
    pub approve_each: bool,
    /// Suppress the default autonomous safety-bypass flags.
    pub skip_default_safety_flags: bool,
    /// Initial terminal width.
    pub cols: u16,
    /// Initial terminal height.
    pub rows: u16,
    /// Time without output before a frame is considered settled.
    pub settle_duration: Duration,
    /// Input, control-key, and resize interactions.
    pub interactions: Vec<TerminalInteraction>,
    /// Marker after which the capture process can be stopped.
    pub stop_marker: Option<String>,
    /// Grace period after the stop marker.
    pub stop_marker_grace: Duration,
    /// Overall capture timeout.
    pub timeout: Duration,
    /// Directory for transcript, frame, cast, and animation artifacts.
    pub artifact_directory: Option<PathBuf>,
}

impl Default for AgentTuiOptions {
    fn default() -> Self {
        Self {
            tool: String::new(),
            working_directory: PathBuf::new(),
            executable: None,
            prefix_args: Vec::new(),
            extra_args: Vec::new(),
            extra_env: HashMap::new(),
            model: None,
            prompt: None,
            system_prompt: None,
            prompt_after: None,
            prompt_key: TerminalKey::Enter,
            resume: None,
            read_only: false,
            plan_only: false,
            approve_each: false,
            skip_default_safety_flags: false,
            cols: 80,
            rows: 24,
            settle_duration: Duration::from_millis(35),
            interactions: Vec::new(),
            stop_marker: None,
            stop_marker_grace: Duration::from_millis(250),
            timeout: Duration::from_secs(30),
            artifact_directory: None,
        }
    }
}

/// Executable, argv, cwd, and environment for an interactive agent launch.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AgentTuiLaunch {
    /// Executable to launch.
    pub file: String,
    /// Shell-free argument vector.
    pub args: Vec<String>,
    /// Working directory.
    pub cwd: Option<PathBuf>,
    /// Environment overrides.
    pub env: HashMap<String, String>,
}

/// Stable semantic event extracted from an agent TUI transcript.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AgentTuiEvent {
    /// User or assistant message.
    Message {
        /// Normalized lowercase role.
        role: String,
        /// Visible message content.
        content: String,
    },
    /// Tool invocation shown by the client.
    ToolCall {
        /// Tool name.
        name: String,
        /// Visible tool input.
        input: String,
    },
}

/// Terminal capture and normalized events for one agent.
#[derive(Debug, Clone)]
pub struct AgentTuiCapture {
    /// Agent client name.
    pub tool: String,
    /// Lossless terminal capture and replay data.
    pub terminal: TerminalCapture,
    /// Stable semantic events extracted from the unrolled transcript.
    pub events: Vec<AgentTuiEvent>,
}

/// Error while preparing or capturing an interactive agent terminal.
#[derive(Debug, Error)]
pub enum AgentTuiError {
    /// Launch options are unsupported or incomplete.
    #[error("{0}")]
    Launch(String),
    /// PTY capture failed.
    #[error(transparent)]
    Capture(#[from] TerminalCaptureError),
}

fn mapped_model(tool: &str, model: &str) -> String {
    match tool {
        "claude" => claude::map_model_to_id(model),
        "codex" => codex::map_model_to_id(model),
        "opencode" => opencode::map_model_to_id(model),
        "agent" => agent::map_model_to_id(model),
        "gemini" => gemini::map_model_to_id(model),
        "qwen" => qwen::map_model_to_id(model),
        _ => model.to_string(),
    }
}

fn push_model(args: &mut Vec<String>, options: &AgentTuiOptions) {
    if let Some(model) = &options.model {
        args.push("--model".into());
        args.push(mapped_model(&options.tool, model));
    }
}

fn claude_args(options: &AgentTuiOptions) -> Vec<String> {
    let mut args = Vec::new();
    if options.read_only {
        args.extend(["--permission-mode".into(), "plan".into()]);
    } else if options.approve_each {
        args.extend(["--permission-mode".into(), "default".into()]);
    } else if !options.skip_default_safety_flags {
        args.push("--dangerously-skip-permissions".into());
    }
    push_model(&mut args, options);
    if let Some(system_prompt) = &options.system_prompt {
        args.extend(["--append-system-prompt".into(), system_prompt.clone()]);
    }
    if let Some(resume) = &options.resume {
        args.extend(["--resume".into(), resume.clone()]);
    }
    args.push("--ax-screen-reader".into());
    args
}

fn codex_args(options: &AgentTuiOptions) -> Vec<String> {
    let mut args = Vec::new();
    push_model(&mut args, options);
    if options.read_only {
        args.extend([
            "--sandbox".into(),
            "read-only".into(),
            "--ask-for-approval".into(),
            "never".into(),
        ]);
    } else if options.approve_each {
        args.extend(["--ask-for-approval".into(), "on-request".into()]);
    } else if !options.skip_default_safety_flags {
        args.push("--dangerously-bypass-approvals-and-sandbox".into());
    }
    args.push("--no-alt-screen".into());
    if let Some(resume) = &options.resume {
        args.extend(["resume".into(), resume.clone()]);
    }
    args
}

fn opencode_args(options: &AgentTuiOptions) -> Vec<String> {
    let mut args = vec!["--mini".into(), "--no-replay".into()];
    push_model(&mut args, options);
    if let Some(resume) = &options.resume {
        args.extend(["--session".into(), resume.clone()]);
    }
    if !options.read_only && !options.skip_default_safety_flags {
        args.push("--auto".into());
    }
    args
}

fn agent_args(options: &AgentTuiOptions) -> Vec<String> {
    let mut args = Vec::new();
    push_model(&mut args, options);
    let permission = if options.read_only {
        Some("readonly")
    } else if options.plan_only {
        Some("plan")
    } else if options.approve_each {
        Some("ask")
    } else {
        None
    };
    if let Some(permission) = permission {
        args.extend(["--permission-mode".into(), permission.into()]);
    }
    if let Some(resume) = &options.resume {
        args.extend(["--resume".into(), resume.clone()]);
    }
    args
}

fn gemini_args(options: &AgentTuiOptions) -> Vec<String> {
    let mut args = Vec::new();
    push_model(&mut args, options);
    if options.read_only {
        args.extend(["--approval-mode".into(), "plan".into()]);
    } else if !options.skip_default_safety_flags {
        args.push("--yolo".into());
    }
    args
}

fn qwen_args(options: &AgentTuiOptions) -> Vec<String> {
    let mut args = Vec::new();
    push_model(&mut args, options);
    if options.read_only {
        args.extend(["--approval-mode".into(), "plan".into()]);
    } else if !options.skip_default_safety_flags {
        args.push("--yolo".into());
    }
    if let Some(resume) = &options.resume {
        args.extend(["--resume".into(), resume.clone()]);
    }
    args
}

/// Build a shell-free interactive launch for a supported agent client.
pub fn build_agent_tui_launch(options: &AgentTuiOptions) -> Result<AgentTuiLaunch, AgentTuiError> {
    if !SUPPORTED_TOOLS.contains(&options.tool.as_str()) {
        return Err(AgentTuiError::Launch(format!(
            "unsupported TUI tool: {}",
            options.tool
        )));
    }
    if options.working_directory.as_os_str().is_empty() {
        return Err(AgentTuiError::Launch(
            "working_directory is required".into(),
        ));
    }
    let generated = match options.tool.as_str() {
        "claude" => claude_args(options),
        "codex" => codex_args(options),
        "opencode" => opencode_args(options),
        "agent" => agent_args(options),
        "gemini" => gemini_args(options),
        "qwen" => qwen_args(options),
        _ => unreachable!("supported tools were validated"),
    };
    let mut args =
        Vec::with_capacity(options.prefix_args.len() + generated.len() + options.extra_args.len());
    args.extend(options.prefix_args.clone());
    args.extend(generated);
    args.extend(options.extra_args.clone());
    let mut env = options.extra_env.clone();
    if options.tool == "opencode" && options.read_only {
        env.insert(
            "OPENCODE_PERMISSION".into(),
            READ_ONLY_OPENCODE_PERMISSION.into(),
        );
    }
    Ok(AgentTuiLaunch {
        file: options
            .executable
            .clone()
            .unwrap_or_else(|| options.tool.clone()),
        args,
        cwd: Some(options.working_directory.clone()),
        env,
    })
}

fn strip_marker(line: &str) -> &str {
    line.trim_start_matches(|character: char| {
        matches!(character, '│' | '┃' | '>' | '›' | '❯' | '•' | '*') || character.is_whitespace()
    })
}

/// Extract stable message and tool-call events without removing repeated states.
pub fn normalize_tui_transcript(transcript: &str) -> Vec<AgentTuiEvent> {
    transcript
        .lines()
        .filter_map(|raw_line| {
            let line = strip_marker(raw_line.trim());
            let (kind, content) = line.split_once(':')?;
            if kind.eq_ignore_ascii_case("user") || kind.eq_ignore_ascii_case("assistant") {
                return Some(AgentTuiEvent::Message {
                    role: kind.to_ascii_lowercase(),
                    content: content.trim().into(),
                });
            }
            if kind.eq_ignore_ascii_case("tool_call") || kind.eq_ignore_ascii_case("tool call") {
                let (name, input) = content
                    .trim()
                    .split_once(char::is_whitespace)
                    .unwrap_or_else(|| (content.trim(), ""));
                return Some(AgentTuiEvent::ToolCall {
                    name: name.into(),
                    input: input.trim().into(),
                });
            }
            None
        })
        .collect()
}

/// Capture and drive an agent's real interactive terminal interface.
pub fn capture_agent_tui(options: AgentTuiOptions) -> Result<AgentTuiCapture, AgentTuiError> {
    let launch = build_agent_tui_launch(&options)?;
    let combined_prompt = match (&options.system_prompt, &options.prompt) {
        (Some(system), Some(prompt)) if options.tool != "claude" => {
            Some(format!("{system}\n\n{prompt}"))
        }
        (Some(system), None) if options.tool != "claude" => Some(system.clone()),
        (_, prompt) => prompt.clone(),
    };
    let mut interactions =
        Vec::with_capacity(options.interactions.len() + usize::from(combined_prompt.is_some()));
    if let Some(prompt) = combined_prompt {
        interactions.push(TerminalInteraction {
            after: options.prompt_after.clone(),
            text: Some(prompt),
            key: Some(options.prompt_key.clone()),
            resize: None,
        });
    }
    interactions.extend(options.interactions.clone());
    let terminal = capture_terminal(TerminalCaptureOptions {
        file: launch.file,
        args: launch.args,
        cwd: launch.cwd,
        env: launch.env,
        cols: options.cols,
        rows: options.rows,
        settle_duration: options.settle_duration,
        interactions,
        stop_marker: options.stop_marker,
        stop_marker_grace: options.stop_marker_grace,
        timeout: options.timeout,
        artifact_directory: options.artifact_directory,
    })?;
    Ok(AgentTuiCapture {
        tool: options.tool,
        events: normalize_tui_transcript(&terminal.transcript),
        terminal,
    })
}
