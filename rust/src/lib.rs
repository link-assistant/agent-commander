//! Agent Commander - Main library interface
//! A Rust library to control agents enclosed in CLI commands
//!
//! Supports multiple CLI agents:
//! - claude: Anthropic Claude Code CLI
//! - codex: OpenAI Codex CLI
//! - opencode: OpenCode CLI
//! - agent: @link-assistant/agent (unrestricted OpenCode fork)

pub mod cli_parser;
pub mod command_builder;
pub mod executor;
pub mod streaming;
pub mod tools;

use serde_json::Value;

pub use cli_parser::{
    parse_args, parse_start_agent_args, parse_stop_agent_args, show_start_agent_help,
    show_stop_agent_help, validate_start_agent_options, validate_stop_agent_options,
    StartAgentOptions, StopAgentOptions, ValidationResult,
};

pub use command_builder::{
    build_agent_command, build_docker_stop_command, build_piped_command, build_screen_stop_command,
    AgentCommandOptions,
};

pub use executor::{
    execute_command, execute_detached, setup_signal_handler, start_command, ExecutionResult,
    ProcessHandle,
};

pub use streaming::{
    create_input_stream, create_output_stream, parse_ndjson, parse_ndjson_line, stringify_ndjson,
    stringify_ndjson_line, JsonInputStream, JsonOutputStream, ParseError,
};

pub use tools::{
    get_tool, is_tool_supported, list_tools, AgentTool, ClaudeTool, CodexTool, OpencodeTool, Tool,
    ToolRegistry,
};

/// Agent options for creating a controller
#[derive(Debug, Clone, Default)]
pub struct AgentOptions {
    /// CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'agent')
    pub tool: String,
    /// Working directory for the agent
    pub working_directory: String,
    /// Prompt for the agent
    pub prompt: Option<String>,
    /// System prompt for the agent
    pub system_prompt: Option<String>,
    /// Model to use (tool-specific)
    pub model: Option<String>,
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
}

/// Agent controller
pub struct Agent {
    options: AgentOptions,
    process_handle: Option<ProcessHandle>,
    output_stream: Option<JsonOutputStream>,
    session_id: Option<String>,
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

        Ok(Self {
            options,
            process_handle: None,
            output_stream: None,
            session_id: None,
        })
    }

    /// Start the agent (non-blocking)
    ///
    /// # Arguments
    /// * `start_options` - Start options
    ///
    /// # Returns
    /// Result indicating success or error
    pub async fn start(&mut self, start_options: AgentStartOptions) -> Result<(), String> {
        // Create output stream for JSON parsing if in JSON mode
        if self.options.json {
            self.output_stream = Some(create_output_stream());
        }

        // Build the command
        let command_options = AgentCommandOptions {
            tool: self.options.tool.clone(),
            working_directory: self.options.working_directory.clone(),
            prompt: self.options.prompt.clone(),
            system_prompt: self.options.system_prompt.clone(),
            model: self.options.model.clone(),
            json: self.options.json,
            resume: self.options.resume.clone(),
            isolation: self.options.isolation.clone(),
            screen_name: self.options.screen_name.clone(),
            container_name: self.options.container_name.clone(),
            detached: start_options.detached,
        };

        let command = build_agent_command(&command_options);

        if start_options.dry_run {
            println!("Dry run - command that would be executed:");
            println!("{}", command);
            return Ok(());
        }

        if start_options.detached {
            // For detached mode, use execute_detached
            execute_detached(&command)
                .await
                .map_err(|e| e.to_string())?;
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
            let handle = start_command(&command, start_options.attached)
                .await
                .map_err(|e| e.to_string())?;
            self.process_handle = Some(handle);
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
                return Ok(AgentResult::default());
            }

            let result = execute_command(&stop_command, false, true)
                .await
                .map_err(|e| e.to_string())?;

            return Ok(AgentResult {
                exit_code: result.exit_code,
                plain_output: result.stdout,
                parsed_output: None,
                session_id: None,
            });
        }

        // For no isolation, wait for process to complete and collect output
        if self.options.isolation == "none" || self.options.isolation.is_empty() {
            let handle = self
                .process_handle
                .as_mut()
                .ok_or("Agent not started or already stopped")?;

            // Wait for the process to exit
            let exit_code = handle.wait_for_exit().await.map_err(|e| e.to_string())?;

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

            // Try to extract session ID
            if is_tool_supported(&self.options.tool) {
                match self.options.tool.as_str() {
                    "claude" => {
                        self.session_id = tools::claude::extract_session_id(&plain_output);
                    }
                    "codex" => {
                        self.session_id = tools::codex::extract_session_id(&plain_output);
                    }
                    "opencode" => {
                        self.session_id = tools::opencode::extract_session_id(&plain_output);
                    }
                    "agent" => {
                        self.session_id = tools::agent::extract_session_id(&plain_output);
                    }
                    _ => {}
                }
            }

            return Ok(AgentResult {
                exit_code,
                plain_output,
                parsed_output,
                session_id: self.session_id.clone(),
            });
        }

        Err(format!(
            "Unsupported isolation mode: {}",
            self.options.isolation
        ))
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_agent_throws_without_tool() {
        let options = AgentOptions {
            working_directory: "/tmp/test".to_string(),
            ..Default::default()
        };
        let result = agent(options);
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(e.contains("tool is required"));
        }
    }

    #[test]
    fn test_agent_throws_without_working_directory() {
        let options = AgentOptions {
            tool: "claude".to_string(),
            ..Default::default()
        };
        let result = agent(options);
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(e.contains("working_directory is required"));
        }
    }

    #[test]
    fn test_agent_throws_for_screen_without_name() {
        let options = AgentOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            isolation: "screen".to_string(),
            ..Default::default()
        };
        let result = agent(options);
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(e.contains("screen_name is required"));
        }
    }

    #[test]
    fn test_agent_throws_for_docker_without_name() {
        let options = AgentOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            isolation: "docker".to_string(),
            ..Default::default()
        };
        let result = agent(options);
        assert!(result.is_err());
        if let Err(e) = result {
            assert!(e.contains("container_name is required"));
        }
    }

    #[test]
    fn test_agent_creates_with_valid_options() {
        let options = AgentOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            isolation: "none".to_string(),
            ..Default::default()
        };
        let result = agent(options);
        assert!(result.is_ok());
    }
}
