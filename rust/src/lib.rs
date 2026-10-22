//! Agent Commander - Main library interface
//! A Rust library to control agents enclosed in CLI commands
//!
//! Supports multiple CLI agents:
//! - claude: Anthropic Claude Code CLI
//! - codex: OpenAI Codex CLI
//! - opencode: OpenCode CLI
//! - agent: @link-assistant/agent (OpenCode fork with native permission modes)
//! - qwen: Qwen Code CLI
//! - gemini: Gemini CLI

pub mod background_tasks;
pub mod claude_transcript;
pub mod cli_parser;
pub mod codex_rollout;
pub mod command_builder;
mod completion;
pub mod error_text;
pub mod executor;
pub mod file_tail;
pub mod live_input;
pub mod permissions;
pub mod result_close;
pub mod result_metadata;
pub mod streaming;
pub mod tool_version;
pub mod tools;
pub mod tui;
pub mod usage_limit;
pub mod usage_windows;

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;

pub use cli_parser::{
    parse_args, parse_start_agent_args, parse_stop_agent_args, show_start_agent_help,
    show_stop_agent_help, validate_start_agent_options, validate_stop_agent_options,
    StartAgentOptions, StopAgentOptions, ValidationResult,
};

pub use command_builder::{
    build_agent_command, build_docker_stop_command, build_piped_command, build_screen_stop_command,
    read_only_unsupported_error, supports_read_only, AgentCommandOptions,
};

pub use permissions::{
    ask_scope, ask_unsupported_error, build_permission_response, normalize_permission_request,
    permission_parity, supports_ask, NormalizedPermissionRequest, PermissionParityRow,
    PermissionRelay, ASK_DECISIONS, ASK_SUPPORTED_TOOLS,
};

pub use executor::{
    execute_command, execute_detached, is_process_group_alive, normalize_exit,
    setup_signal_handler, signal_from_exit_code, signal_name, start_command,
    start_command_with_stdin, ExecutionResult, ProcessHandle, DEFAULT_KILL_AFTER,
    DEFAULT_PIPE_DRAIN,
};

pub use background_tasks::{
    assess_background_tasks, extract_observed_models, is_real_model_id, print_wait_ceiling_seconds,
    track_background_tasks, BackgroundTask, BackgroundTaskAssessment, BackgroundTaskState,
    StoppedBackgroundTask, PRINT_BG_CEILING_PATTERN,
};

pub use result_close::{
    has_final_result, wait_for_exit_after_result, ResultCloseOptions, StdoutMessageReader,
    DEFAULT_RESULT_POLL,
};

pub use codex_rollout::{
    apply_codex_rollout_usage_limit, apply_codex_rollout_usage_windows, can_resume_codex_session,
    classify_codex_rate_limit_snapshot, codex_rollout_limit_facts, codex_sessions_dir,
    detect_codex_rollout_usage_limit, find_codex_rollout_file, is_codex_rollout_file_name,
    read_codex_rollout_limit_facts, CodexLimitVerdict, CodexRolloutLimitFacts, CodexRolloutOptions,
    CODEX_ROLLOUT_LIMIT_SOURCE, CODEX_SESSIONS_DIRNAME, ROLLOUT_TAIL_BYTES,
};

pub use claude_transcript::{
    apply_claude_transcript_usage_limit, claude_project_slugs, claude_transcript_api_error,
    claude_transcript_candidates, read_claude_transcript_api_error, ClaudeTranscriptApiError,
    ClaudeTranscriptOptions, CLAUDE_TRANSCRIPT_LIMIT_SOURCE, TRANSCRIPT_TAIL_BYTES,
};

pub use file_tail::read_file_tail;
pub use live_input::{
    build_interrupt_frame, build_user_input_frame, live_input_unsupported_error,
    supports_live_input,
};

pub use result_metadata::{
    build_normalized_result_metadata, BuildMetadataOptions, PricingInfo, ResultMetadata,
};

pub use error_text::{first_error_text, stringify_error_value, MAX_ERROR_TEXT_LENGTH};

pub use usage_limit::{
    classify_debug_lines, classify_rate_limit_event, detect_usage_limit_sources,
    extract_reset_time, extract_timezone, format_epoch_reset_time_utc, is_recoverable_tool_error,
    is_usage_limit_text, limit_scan_text, DebugLines, UsageLimitVerdict,
};

pub use streaming::{
    create_input_stream, create_output_stream, parse_json_records, parse_ndjson, parse_ndjson_line,
    stringify_ndjson, stringify_ndjson_line, JsonInputStream, JsonOutputStream, JsonRecordEvent,
    JsonRecordScanner, ParseError,
};

pub use tools::{
    get_tool, is_tool_supported, list_tools, AgentTool, ClaudeTool, CodexTool, OpencodeTool, Tool,
    ToolRegistry,
};

pub use usage_windows::{
    claude_rate_limit_windows, codex_rate_limit_windows, extract_usage_windows,
    merge_usage_windows, usage_windows_from_message, UsageWindow, USAGE_WINDOW_KINDS,
};

pub use tool_version::{
    build_version_command, compare_versions, get_tool_version, parse_tool_version,
    tool_version_from_output, ToolVersion,
};

pub use tools::launch_options::{
    check_launch_options_supported, codex_mcp_servers_override, launch_capabilities,
    normalize_reasoning_effort, to_toml_value, LaunchCapabilities, LaunchOptions,
    CLAUDE_REASONING_EFFORTS, CODEX_REASONING_EFFORTS,
};

/// Agent options for creating a controller
#[derive(Debug, Clone, Default)]
pub struct AgentOptions {
    /// CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini')
    pub tool: String,
    /// Working directory for the agent
    pub working_directory: String,
    /// Prompt for the agent
    pub prompt: Option<String>,
    /// File containing prompt input for stdin-based tools
    pub prompt_file: Option<String>,
    /// System prompt for the agent
    pub system_prompt: Option<String>,
    /// Append to the default system prompt (tool-specific)
    pub append_system_prompt: Option<String>,
    /// Model to use (tool-specific)
    pub model: Option<String>,
    /// Fallback model to use when the primary model is overloaded (tool-specific)
    pub fallback_model: Option<String>,
    /// Isolation mode: 'none', 'screen', 'docker'
    pub isolation: String,
    /// Screen session name (for screen isolation)
    pub screen_name: Option<String>,
    /// Container name (for docker isolation)
    pub container_name: Option<String>,
    /// Enable JSON output mode
    pub json: bool,
    /// Resume a previous session (tool-specific)
    pub resume: Option<String>,
    /// Enable verbose output (tool-specific)
    pub verbose: bool,
    /// Re-emit user messages in streaming output (tool-specific)
    pub replay_user_messages: bool,
    /// Use a specific session ID (tool-specific)
    pub session_id: Option<String>,
    /// Fork a resumed session into a new session (tool-specific)
    pub fork_session: bool,
    /// Enforce native read-only/planning mode
    pub read_only: bool,
    /// Enforce native planning mode (where the tool distinguishes it)
    pub plan_only: bool,
    /// Approve each mutating command (ask mode), relayed over the tool's native
    /// per-command JSON permission protocol (only `claude` and `agent`)
    pub approve_each: bool,
    /// Override the tool executable path/name
    pub executable: Option<String>,
    /// Extra raw arguments appended after typed tool arguments
    pub extra_args: Vec<String>,
    /// Extra environment variables applied to the tool executable
    pub extra_env: Vec<(String, String)>,
    /// Variables removed from the inherited environment of the tool
    pub unset_env: Vec<String>,
    /// Do not add default autonomous safety bypass flags
    pub skip_default_safety_flags: bool,
    /// Shared launch options: reasoning effort, MCP servers, strict MCP
    /// configuration and extra workspace directories
    pub launch: LaunchOptions,
    /// Keep stdin open for [`Agent::send_message`] and [`Agent::interrupt`]
    /// (`claude`, `qwen`, `agent`; attached runs without isolation). The
    /// prompt becomes the first stream-json frame and JSON output is forced.
    pub live_input: bool,
}

/// Agent result from stop()
#[derive(Debug, Clone, Default)]
pub struct AgentResult {
    /// Exit code from the process
    pub exit_code: i32,
    /// Plain text output (stdout + stderr)
    pub plain_output: String,
    /// Parsed JSON messages (if tool supports it)
    pub parsed_output: Option<Vec<Value>>,
    /// Session ID for resuming
    pub session_id: Option<String>,
    /// Aggregated stream token usage, when the tool exposes it
    pub usage: Option<Value>,
    /// Stable normalized metadata for caller reporting
    pub metadata: ResultMetadata,
}

/// Agent start options
#[derive(Debug, Clone, Default)]
pub struct AgentStartOptions {
    /// If true, just show the command
    pub dry_run: bool,
    /// Run in detached mode
    pub detached: bool,
    /// Stream output to console
    pub attached: bool,
}

/// Agent stop options
#[derive(Debug, Clone, Default)]
pub struct AgentStopOptions {
    /// If true, just show the command
    pub dry_run: bool,
    /// Stop a process that stays this long after its final result once no
    /// background task runs (hive-mind#1280); `None` waits for it to exit
    pub close_timeout: Option<std::time::Duration>,
    /// Extra time a process may stay after its result while background tasks
    /// run; `None` leaves them to the tool's own ceiling
    pub background_wait: Option<std::time::Duration>,
    /// The caller already stopped the process after its final result
    pub terminated_after_result: bool,
}

/// Agent controller
pub struct Agent {
    options: AgentOptions,
    process_handle: Option<ProcessHandle>,
    output_stream: Option<JsonOutputStream>,
    session_id: Option<String>,
    prompt_temp_dir: Option<PathBuf>,
}

fn supports_prompt_file_input(tool: &str) -> bool {
    matches!(
        tool,
        "claude" | "codex" | "opencode" | "agent" | "qwen" | "gemini"
    )
}

fn build_prompt_file_content(
    tool: &str,
    prompt: Option<&str>,
    system_prompt: Option<&str>,
) -> String {
    if tool == "claude" {
        return prompt.unwrap_or_default().to_string();
    }

    match (system_prompt, prompt) {
        (Some(system_prompt), Some(prompt)) => format!("{}\n\n{}", system_prompt, prompt),
        (Some(system_prompt), None) => system_prompt.to_string(),
        (None, Some(prompt)) => prompt.to_string(),
        (None, None) => String::new(),
    }
}

/// Names of prompt directories created by this process
static PROMPT_DIR_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Names tried before a prompt directory is given up
const PROMPT_DIR_ATTEMPTS: usize = 16;

/// Create a new directory for a prompt file under `parent`.
///
/// The name holds the pid, the clock and a per-process sequence, because
/// controllers started in parallel can read the same clock tick (macOS clocks
/// are coarse). A name that already exists, such as a leftover from a reused
/// pid, is skipped.
async fn create_prompt_temp_dir(parent: &Path, nanos: u128) -> Result<PathBuf, String> {
    for _ in 0..PROMPT_DIR_ATTEMPTS {
        let sequence = PROMPT_DIR_SEQUENCE.fetch_add(1, Ordering::Relaxed);
        let dir = parent.join(format!(
            "agent-commander-{}-{nanos}-{sequence}",
            std::process::id()
        ));
        match tokio::fs::create_dir(&dir).await {
            Ok(()) => return Ok(dir),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error.to_string()),
        }
    }
    Err(format!(
        "could not create a prompt directory in {}",
        parent.display()
    ))
}

fn should_create_prompt_file(options: &AgentOptions, dry_run: bool) -> bool {
    if dry_run || options.prompt_file.is_some() || !supports_prompt_file_input(&options.tool) {
        return false;
    }

    if options.tool == "claude" {
        return options.prompt.is_some();
    }

    options.prompt.is_some() || options.system_prompt.is_some()
}

fn extract_usage_value(tool: &str, output: &str) -> Option<Value> {
    match tool {
        "claude" => serde_json::to_value(tools::claude::extract_usage(output)).ok(),
        "codex" => serde_json::to_value(tools::codex::extract_usage(output)).ok(),
        "opencode" => serde_json::to_value(tools::opencode::extract_usage(output)).ok(),
        "agent" => serde_json::to_value(tools::agent::extract_usage(output)).ok(),
        "qwen" => serde_json::to_value(tools::qwen::extract_usage(output)).ok(),
        "gemini" => serde_json::to_value(tools::gemini::extract_usage(output)).ok(),
        _ => None,
    }
}

impl Agent {
    /// Create a new agent controller
    ///
    /// # Arguments
    /// * `options` - Agent configuration
    ///
    /// # Returns
    /// Result with Agent or error message
    pub fn new(options: AgentOptions) -> Result<Self, String> {
        // Validate required options
        if options.tool.is_empty() {
            return Err("tool is required".to_string());
        }
        if options.working_directory.is_empty() {
            return Err("working_directory is required".to_string());
        }
        if options.isolation == "screen" && options.screen_name.is_none() {
            return Err("screen_name is required for screen isolation".to_string());
        }
        if options.isolation == "docker" && options.container_name.is_none() {
            return Err("container_name is required for docker isolation".to_string());
        }
        if (options.read_only || options.plan_only) && !supports_read_only(&options.tool) {
            return Err(read_only_unsupported_error(&options.tool));
        }
        if options.approve_each && !supports_ask(&options.tool) {
            return Err(ask_unsupported_error(&options.tool));
        }

        Ok(Self {
            options,
            process_handle: None,
            output_stream: None,
            session_id: None,
            prompt_temp_dir: None,
        })
    }

    async fn cleanup_prompt_temp_dir(&mut self) {
        if let Some(dir) = self.prompt_temp_dir.take() {
            let _ = tokio::fs::remove_dir_all(dir).await;
        }
    }

    async fn prepare_prompt_file(&mut self, dry_run: bool) -> Result<Option<String>, String> {
        if !should_create_prompt_file(&self.options, dry_run) {
            return Ok(self.options.prompt_file.clone());
        }

        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_nanos();
        let temp_dir = create_prompt_temp_dir(&std::env::temp_dir(), nanos).await?;
        self.prompt_temp_dir = Some(temp_dir.clone());
        let prompt_file = temp_dir.join("prompt.txt");
        let content = build_prompt_file_content(
            &self.options.tool,
            self.options.prompt.as_deref(),
            self.options.system_prompt.as_deref(),
        );

        let mut open_options = tokio::fs::OpenOptions::new();
        open_options.write(true).create_new(true);
        #[cfg(unix)]
        {
            open_options.mode(0o600);
        }
        let mut file = open_options
            .open(&prompt_file)
            .await
            .map_err(|e| e.to_string())?;
        file.write_all(content.as_bytes())
            .await
            .map_err(|e| e.to_string())?;

        Ok(Some(prompt_file.to_string_lossy().into_owned()))
    }

    /// Start the agent (non-blocking)
    ///
    /// # Arguments
    /// * `start_options` - Start options
    ///
    /// # Returns
    /// Result indicating success or error
    pub async fn start(&mut self, start_options: AgentStartOptions) -> Result<(), String> {
        // Reject launch options the tool cannot honor before any side effects.
        check_launch_options_supported(&self.options.tool, &self.options.launch)?;
        let live = self.options.live_input;
        if live && !supports_live_input(&self.options.tool) {
            return Err(live_input_unsupported_error(&self.options.tool));
        }
        let isolated = !(self.options.isolation == "none" || self.options.isolation.is_empty());
        if live && !start_options.dry_run && (start_options.detached || isolated) {
            return Err(
                "live_input needs an attached run without isolation (stdin is piped to the tool)."
                    .to_string(),
            );
        }

        // Create output stream for JSON parsing if in JSON mode
        if self.options.json || live {
            self.output_stream = Some(create_output_stream());
        }

        // Live input writes the prompt as the first stdin frame instead.
        let prepared_prompt_file = match self
            .prepare_prompt_file(start_options.dry_run || live)
            .await
        {
            Ok(prompt_file) => prompt_file,
            Err(error) => {
                self.cleanup_prompt_temp_dir().await;
                return Err(error);
            }
        };
        let prompt_handled_by_temp_file =
            prepared_prompt_file.is_some() && self.options.prompt_file.is_none();

        // Build the command
        let command_options = AgentCommandOptions {
            tool: self.options.tool.clone(),
            working_directory: self.options.working_directory.clone(),
            prompt: if prompt_handled_by_temp_file || live {
                None
            } else {
                self.options.prompt.clone()
            },
            prompt_file: prepared_prompt_file,
            system_prompt: if prompt_handled_by_temp_file && self.options.tool != "claude" {
                None
            } else {
                self.options.system_prompt.clone()
            },
            append_system_prompt: self.options.append_system_prompt.clone(),
            model: self.options.model.clone(),
            fallback_model: self.options.fallback_model.clone(),
            json: self.options.json || live,
            verbose: self.options.verbose,
            replay_user_messages: self.options.replay_user_messages,
            resume: self.options.resume.clone(),
            session_id: self.options.session_id.clone(),
            fork_session: self.options.fork_session,
            read_only: self.options.read_only,
            plan_only: self.options.plan_only,
            approve_each: self.options.approve_each,
            stream_input: live,
            executable: self.options.executable.clone(),
            extra_args: self.options.extra_args.clone(),
            extra_env: self.options.extra_env.clone(),
            unset_env: self.options.unset_env.clone(),
            skip_default_safety_flags: self.options.skip_default_safety_flags,
            isolation: self.options.isolation.clone(),
            screen_name: self.options.screen_name.clone(),
            container_name: self.options.container_name.clone(),
            detached: start_options.detached,
            launch: self.options.launch.clone(),
        };

        let command = build_agent_command(&command_options);

        if start_options.dry_run {
            println!("Dry run - command that would be executed:");
            println!("{}", command);
            return Ok(());
        }

        if start_options.detached {
            // For detached mode, use execute_detached
            if let Err(error) = execute_detached(&command).await.map_err(|e| e.to_string()) {
                self.cleanup_prompt_temp_dir().await;
                return Err(error);
            }
            println!("Agent started in detached mode");
            if self.options.isolation == "screen" {
                if let Some(ref name) = self.options.screen_name {
                    println!("Screen session: {}", name);
                }
            } else if self.options.isolation == "docker" {
                if let Some(ref name) = self.options.container_name {
                    println!("Container: {}", name);
                }
            }
        } else {
            // For attached mode, start command without waiting
            let started = if live {
                start_command_with_stdin(&command, start_options.attached).await
            } else {
                start_command(&command, start_options.attached).await
            };
            let handle = match started.map_err(|e| e.to_string()) {
                Ok(handle) => handle,
                Err(error) => {
                    self.cleanup_prompt_temp_dir().await;
                    return Err(error);
                }
            };
            self.process_handle = Some(handle);
            if live {
                // Kick off the turn by sending the user prompt as the first frame.
                let prompt = self.options.prompt.clone().map_or(Value::Null, Value::from);
                let frame = build_user_input_frame(
                    &self.options.tool,
                    &prompt,
                    self.options.system_prompt.as_deref(),
                )?;
                self.write_input_frame(&frame).await?;
            }
        }

        Ok(())
    }

    /// Stop the agent and collect output
    ///
    /// # Arguments
    /// * `stop_options` - Stop options
    ///
    /// # Returns
    /// Result with agent output or error
    pub async fn stop(&mut self, stop_options: AgentStopOptions) -> Result<AgentResult, String> {
        // For isolation modes, send stop command
        if self.options.isolation == "screen" || self.options.isolation == "docker" {
            let stop_command = if self.options.isolation == "screen" {
                let screen_name = self
                    .options
                    .screen_name
                    .as_ref()
                    .ok_or("screen_name is required to stop screen session")?;
                build_screen_stop_command(screen_name)
            } else {
                let container_name = self
                    .options
                    .container_name
                    .as_ref()
                    .ok_or("container_name is required to stop docker container")?;
                build_docker_stop_command(container_name)
            };

            if stop_options.dry_run {
                println!("Dry run - command that would be executed:");
                println!("{}", stop_command);
                return Ok(AgentResult {
                    metadata: build_normalized_result_metadata(BuildMetadataOptions {
                        tool: &self.options.tool,
                        exit_code: 0,
                        plain_output: "",
                        parsed_output: None,
                        session_id: None,
                        usage: None,
                        ..Default::default()
                    }),
                    ..Default::default()
                });
            }

            let result = match execute_command(&stop_command, false, true)
                .await
                .map_err(|e| e.to_string())
            {
                Ok(result) => result,
                Err(error) => {
                    self.cleanup_prompt_temp_dir().await;
                    return Err(error);
                }
            };
            self.cleanup_prompt_temp_dir().await;

            let metadata = build_normalized_result_metadata(BuildMetadataOptions {
                tool: &self.options.tool,
                exit_code: result.exit_code,
                plain_output: &result.stdout,
                parsed_output: None,
                session_id: None,
                usage: None,
                signal: result.signal.clone(),
                ..Default::default()
            });

            return Ok(AgentResult {
                exit_code: result.exit_code,
                plain_output: result.stdout,
                parsed_output: None,
                session_id: None,
                usage: None,
                metadata,
            });
        }

        // For no isolation, wait for process to complete and collect output
        if self.options.isolation == "none" || self.options.isolation.is_empty() {
            if self.process_handle.is_none() {
                self.cleanup_prompt_temp_dir().await;
                return Err("Agent not started or already stopped".to_string());
            }
            let handle = self
                .process_handle
                .as_mut()
                .ok_or("Agent not started or already stopped")?;
            // End live input: the tool finishes the queued input and exits.
            handle.end_stdin();

            // Wait for the process to exit, closing it when it outlives its result
            let close = ResultCloseOptions {
                close_timeout: stop_options.close_timeout,
                background_wait: stop_options.background_wait,
                ..Default::default()
            };
            let waited = wait_for_exit_after_result(handle, &self.options.tool, close).await;
            let (exit_code, terminated_after_result) = match waited.map_err(|e| e.to_string()) {
                Ok((exit_code, terminated)) => (
                    exit_code,
                    terminated || stop_options.terminated_after_result,
                ),
                Err(error) => {
                    self.cleanup_prompt_temp_dir().await;
                    return Err(error);
                }
            };

            let (stdout, stderr, _) = handle.get_output();

            // Combine stdout and stderr for plain output
            let plain_output = if stderr.is_empty() {
                stdout.to_string()
            } else {
                format!("{}\n{}", stdout, stderr)
            };

            // Process output through stream if available
            let mut parsed_output = None;
            if let Some(ref mut stream) = self.output_stream {
                stream.process(stdout);
                stream.flush();
                let messages = stream.get_messages();
                if !messages.is_empty() {
                    parsed_output = Some(messages.to_vec());
                }
            }

            if parsed_output.is_none() {
                parsed_output = Some(if self.options.tool == "gemini" {
                    tools::gemini::parse_output(stdout)
                } else {
                    streaming::parse_json_records(stdout)
                });
            }

            // Try to extract session ID
            if is_tool_supported(&self.options.tool) {
                match self.options.tool.as_str() {
                    "claude" => {
                        self.session_id = tools::claude::extract_session_id(stdout);
                    }
                    "codex" => {
                        self.session_id = tools::codex::extract_session_id(stdout);
                    }
                    "opencode" => {
                        self.session_id = tools::opencode::extract_session_id(stdout);
                    }
                    "agent" => {
                        self.session_id = tools::agent::extract_session_id(stdout);
                    }
                    "qwen" => self.session_id = tools::qwen::extract_session_id(stdout),
                    "gemini" => self.session_id = tools::gemini::extract_session_id(stdout),
                    _ => {}
                }
            }

            let usage = extract_usage_value(&self.options.tool, stdout);
            let mut metadata = build_normalized_result_metadata(BuildMetadataOptions {
                tool: &self.options.tool,
                exit_code,
                plain_output: &plain_output,
                parsed_output: parsed_output.as_deref(),
                session_id: self.session_id.clone(),
                usage: usage.clone(),
                signal: handle.signal().map(String::from),
                terminated_after_result,
            });
            // Codex and Claude can leave a usage limit only in their session
            // files (hive-mind#3570)
            let rollout_options =
                CodexRolloutOptions::for_run_env(&self.options.extra_env, &self.options.unset_env);
            codex_rollout::apply_codex_rollout_usage_limit(&mut metadata, &rollout_options);
            codex_rollout::apply_codex_rollout_usage_windows(&mut metadata, &rollout_options);
            if (self.options.json || self.options.tool == "agent")
                && is_tool_supported(&self.options.tool)
            {
                completion::require_completed_result(
                    &mut metadata,
                    &self.options.tool,
                    parsed_output.as_deref().unwrap_or_default(),
                );
            }
            claude_transcript::apply_claude_transcript_usage_limit(
                &mut metadata,
                &ClaudeTranscriptOptions::for_run_env(
                    &self.options.working_directory,
                    &self.options.extra_env,
                    &self.options.unset_env,
                ),
            );

            let result = AgentResult {
                exit_code,
                plain_output,
                parsed_output,
                session_id: self.session_id.clone(),
                usage,
                metadata,
            };
            self.cleanup_prompt_temp_dir().await;
            return Ok(result);
        }

        Err(format!(
            "Unsupported isolation mode: {}",
            self.options.isolation
        ))
    }

    /// Cancel a running process and collect its final output and metadata.
    ///
    /// A process cancelled after its final result is judged by that result.
    pub async fn cancel(&mut self) -> Result<AgentResult, String> {
        let mut terminated_after_result = false;
        if self.options.isolation == "none" || self.options.isolation.is_empty() {
            if let Some(handle) = self.process_handle.as_mut() {
                let mut reader = StdoutMessageReader::new();
                terminated_after_result = !handle.try_wait().map_err(|e| e.to_string())?
                    && has_final_result(&self.options.tool, reader.read(&handle.peek_stdout()));
                handle
                    .terminate()
                    .await
                    .map_err(|error| error.to_string())?;
            }
        }
        self.stop(AgentStopOptions {
            terminated_after_result,
            ..Default::default()
        })
        .await
    }

    /// Get the current session ID (if available)
    pub fn get_session_id(&self) -> Option<&String> {
        self.session_id.as_ref()
    }

    /// Get all collected messages from the output stream
    pub fn get_messages(&self) -> Vec<&Value> {
        if let Some(ref stream) = self.output_stream {
            stream.get_messages().iter().collect()
        } else {
            Vec::new()
        }
    }
}

/// Create an agent controller (convenience function)
///
/// # Arguments
/// * `options` - Agent configuration
///
/// # Returns
/// Result with Agent or error message
pub fn agent(options: AgentOptions) -> Result<Agent, String> {
    Agent::new(options)
}

// Tests are in rust/tests/lib_tests.rs

#[cfg(test)]
mod prompt_dir_tests {
    use super::{create_prompt_temp_dir, PROMPT_DIR_SEQUENCE};
    use std::sync::atomic::Ordering;

    #[tokio::test]
    async fn prompt_dirs_are_unique_within_one_clock_tick() {
        let parent = tempfile::tempdir().expect("parent directory");
        let first = create_prompt_temp_dir(parent.path(), 7).await.unwrap();
        let second = create_prompt_temp_dir(parent.path(), 7).await.unwrap();
        assert_ne!(first, second);
        assert!(first.is_dir() && second.is_dir());
    }

    #[tokio::test]
    async fn existing_prompt_dir_names_are_skipped() {
        let parent = tempfile::tempdir().expect("parent directory");
        let next = PROMPT_DIR_SEQUENCE.load(Ordering::Relaxed);
        for sequence in next..next + 3 {
            std::fs::create_dir(parent.path().join(format!(
                "agent-commander-{}-9-{sequence}",
                std::process::id()
            )))
            .unwrap();
        }
        let dir = create_prompt_temp_dir(parent.path(), 9).await.unwrap();
        assert!(dir.is_dir());
        assert_eq!(std::fs::read_dir(parent.path()).unwrap().count(), 4);
    }
}
