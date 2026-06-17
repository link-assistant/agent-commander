//! Build command strings for different agent tools

use crate::tools::{
    agent::{self, AgentBuildOptions},
    claude::{self, ClaudeBuildOptions},
    codex::{self, CodexBuildOptions},
    gemini::{self, GeminiBuildOptions},
    is_tool_supported,
    opencode::{self, OpencodeBuildOptions},
    qwen::{self, QwenBuildOptions},
};

/// Agent command build options
#[derive(Debug, Clone, Default)]
pub struct AgentCommandOptions {
    pub tool: String,
    pub working_directory: String,
    pub prompt: Option<String>,
    pub prompt_file: Option<String>,
    pub system_prompt: Option<String>,
    pub append_system_prompt: Option<String>,
    pub model: Option<String>,
    pub fallback_model: Option<String>,
    pub json: bool,
    pub verbose: bool,
    pub replay_user_messages: bool,
    pub resume: Option<String>,
    pub session_id: Option<String>,
    pub fork_session: bool,
    pub read_only: bool,
    pub plan_only: bool,
    pub executable: Option<String>,
    pub extra_args: Vec<String>,
    pub extra_env: Vec<(String, String)>,
    pub skip_default_safety_flags: bool,
    pub isolation: String,
    pub screen_name: Option<String>,
    pub container_name: Option<String>,
    pub detached: bool,
}

/// Check whether a tool has an enforceable native read-only/planning mode.
pub fn supports_read_only(tool: &str) -> bool {
    matches!(
        tool,
        "claude" | "codex" | "opencode" | "gemini" | "qwen" | "agent"
    )
}

/// Build the standard error for tools without enforceable read-only mode.
pub fn read_only_unsupported_error(tool: &str) -> String {
    format!(
        "Tool \"{}\" does not support enforceable read-only mode. Choose one of: claude, codex, opencode, gemini, qwen, agent; or run without --read-only.",
        tool
    )
}

/// Escape quotes in strings for shell commands (single quotes)
fn escape_quotes(s: &str) -> String {
    s.replace('\'', "'\\''")
}

/// Escape strings for use inside bash -c "..."
fn escape_for_bash_c(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('"', "\\\"")
        .replace('$', "\\$")
        .replace('`', "\\`")
}

/// Build the base tool command (generic)
fn build_tool_command(tool: &str, prompt: Option<&str>, system_prompt: Option<&str>) -> String {
    let mut command = tool.to_string();

    if let Some(p) = prompt {
        command.push_str(&format!(" --prompt \"{}\"", escape_quotes(p)));
    }

    if let Some(sp) = system_prompt {
        command.push_str(&format!(" --system-prompt \"{}\"", escape_quotes(sp)));
    }

    command
}

/// Build screen isolation command
fn build_screen_command(base_command: &str, screen_name: Option<&str>, detached: bool) -> String {
    let session_name = screen_name.map(|s| s.to_string()).unwrap_or_else(|| {
        format!(
            "agent-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        )
    });

    if detached {
        // Start detached screen session
        format!(
            "screen -dmS \"{}\" bash -c '{}'",
            session_name,
            escape_quotes(base_command)
        )
    } else {
        // Start attached screen session
        format!(
            "screen -S \"{}\" bash -c '{}'",
            session_name,
            escape_quotes(base_command)
        )
    }
}

/// Build docker isolation command
fn build_docker_command(
    base_command: &str,
    container_name: Option<&str>,
    working_directory: &str,
    detached: bool,
) -> String {
    let name = container_name.map(|s| s.to_string()).unwrap_or_else(|| {
        format!(
            "agent-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_millis()
        )
    });

    let mut command = "docker run".to_string();

    if detached {
        command.push_str(" -d");
    } else {
        command.push_str(" -it");
    }

    command.push_str(&format!(" --name \"{}\"", name));
    command.push_str(&format!(
        " -v \"{}:{}\"",
        working_directory, working_directory
    ));
    command.push_str(&format!(" -w \"{}\"", working_directory));
    command.push_str(" node:18-slim");
    command.push_str(&format!(" bash -c '{}'", escape_quotes(base_command)));

    command
}

/// Build the command for executing an agent
///
/// # Arguments
/// * `options` - Command options
///
/// # Returns
/// The command string
pub fn build_agent_command(options: &AgentCommandOptions) -> String {
    // A planning request implies a read-only restriction for tools that do not
    // distinguish the two modes.
    let read_only_requested = options.read_only || options.plan_only;

    assert!(
        !(read_only_requested && !supports_read_only(&options.tool)),
        "{}",
        read_only_unsupported_error(&options.tool)
    );

    // Build base command using tool-specific builder if available
    let base_command = if is_tool_supported(&options.tool) {
        match options.tool.as_str() {
            "claude" => claude::build_command(&ClaudeBuildOptions {
                prompt: options.prompt.clone(),
                prompt_file: options.prompt_file.clone(),
                system_prompt: options.system_prompt.clone(),
                append_system_prompt: options.append_system_prompt.clone(),
                model: options.model.clone(),
                fallback_model: options.fallback_model.clone(),
                json: options.json,
                json_input: false,
                verbose: options.verbose,
                replay_user_messages: options.replay_user_messages,
                resume: options.resume.clone(),
                session_id: options.session_id.clone(),
                fork_session: options.fork_session,
                print: false,
                read_only: read_only_requested,
                executable: options.executable.clone(),
                extra_env: options.extra_env.clone(),
                extra_args: options.extra_args.clone(),
                skip_default_safety_flags: options.skip_default_safety_flags,
                permission_mode: None,
            }),
            "codex" => codex::build_command(&CodexBuildOptions {
                prompt: options.prompt.clone(),
                prompt_file: options.prompt_file.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                json: options.json,
                resume: options.resume.clone(),
                read_only: read_only_requested,
                executable: options.executable.clone(),
                extra_env: options.extra_env.clone(),
                extra_args: options.extra_args.clone(),
                skip_default_safety_flags: options.skip_default_safety_flags,
                sandbox_mode: None,
                approval_mode: None,
            }),
            "opencode" => opencode::build_command(&OpencodeBuildOptions {
                prompt: options.prompt.clone(),
                prompt_file: options.prompt_file.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                json: options.json,
                resume: options.resume.clone(),
                read_only: read_only_requested,
                executable: options.executable.clone(),
                extra_env: options.extra_env.clone(),
                extra_args: options.extra_args.clone(),
            }),
            "agent" => agent::build_command(&AgentBuildOptions {
                prompt: options.prompt.clone(),
                prompt_file: options.prompt_file.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                compact_json: false,
                use_existing_claude_oauth: false,
                read_only: read_only_requested,
                plan_only: options.plan_only,
                permission_mode: None,
                permission: None,
                executable: options.executable.clone(),
                extra_env: options.extra_env.clone(),
                extra_args: options.extra_args.clone(),
            }),
            "gemini" => {
                let options = GeminiBuildOptions {
                    prompt: options.prompt.clone(),
                    prompt_file: options.prompt_file.clone(),
                    system_prompt: options.system_prompt.clone(),
                    model: options.model.clone(),
                    json: options.json,
                    read_only: read_only_requested,
                    executable: options.executable.clone(),
                    extra_env: options.extra_env.clone(),
                    extra_args: options.extra_args.clone(),
                    skip_default_safety_flags: options.skip_default_safety_flags,
                    ..GeminiBuildOptions::new()
                };
                gemini::build_command(&options)
            }
            "qwen" => {
                let options = QwenBuildOptions {
                    prompt: options.prompt.clone(),
                    prompt_file: options.prompt_file.clone(),
                    system_prompt: options.system_prompt.clone(),
                    model: options.model.clone(),
                    json: options.json,
                    resume: options.resume.clone(),
                    read_only: read_only_requested,
                    executable: options.executable.clone(),
                    extra_env: options.extra_env.clone(),
                    extra_args: options.extra_args.clone(),
                    skip_default_safety_flags: options.skip_default_safety_flags,
                    ..QwenBuildOptions::new()
                };
                qwen::build_command(&options)
            }
            _ => build_tool_command(
                &options.tool,
                options.prompt.as_deref(),
                options.system_prompt.as_deref(),
            ),
        }
    } else {
        // Unknown tool, use generic command builder
        build_tool_command(
            &options.tool,
            options.prompt.as_deref(),
            options.system_prompt.as_deref(),
        )
    };

    // Wrap in bash -c with working directory change
    let mut full_command = format!(
        "bash -c \"cd {} && {}\"",
        escape_for_bash_c(&options.working_directory),
        escape_for_bash_c(&base_command)
    );

    // Apply isolation wrapper
    match options.isolation.as_str() {
        "screen" => {
            full_command = build_screen_command(
                &full_command,
                options.screen_name.as_deref(),
                options.detached,
            );
        }
        "docker" => {
            full_command = build_docker_command(
                &full_command,
                options.container_name.as_deref(),
                &options.working_directory,
                options.detached,
            );
        }
        _ => {}
    }

    full_command
}

/// Build stop command for screen sessions
///
/// # Arguments
/// * `screen_name` - Screen session name
///
/// # Returns
/// Stop command
pub fn build_screen_stop_command(screen_name: &str) -> String {
    format!("screen -S \"{}\" -X quit", screen_name)
}

/// Build stop command for docker containers
///
/// # Arguments
/// * `container_name` - Container name
///
/// # Returns
/// Stop command
pub fn build_docker_stop_command(container_name: &str) -> String {
    format!(
        "docker stop \"{}\" && docker rm \"{}\"",
        container_name, container_name
    )
}

/// Build stdin piping command for tools that accept input via stdin
///
/// # Arguments
/// * `input` - Input to pipe
/// * `command` - Command to pipe to
///
/// # Returns
/// Piped command
pub fn build_piped_command(input: &str, command: &str) -> String {
    let escaped_input = escape_quotes(input);
    format!("printf '%s' '{}' | {}", escaped_input, command)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_build_agent_command_basic_claude() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Hello".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("bash -c"));
        assert!(command.contains("cd"));
        assert!(command.contains("/tmp/test"));
        assert!(command.contains("claude"));
        assert!(command.contains("--prompt"));
        assert!(command.contains("Hello"));
    }

    #[test]
    fn test_build_agent_command_with_system_prompt() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Hello".to_string()),
            system_prompt: Some("You are helpful".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--prompt"));
        assert!(command.contains("--system-prompt"));
        assert!(command.contains("You are helpful"));
    }

    #[test]
    fn test_build_agent_command_claude_with_fallback_model() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            model: Some("opus".to_string()),
            fallback_model: Some("sonnet".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--model"));
        assert!(command.contains("claude-opus-4-7"));
        assert!(command.contains("--fallback-model"));
        assert!(command.contains("claude-sonnet-4-6"));
    }

    #[test]
    fn test_build_agent_command_claude_with_append_system_prompt() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            append_system_prompt: Some("Extra instructions".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--append-system-prompt"));
        assert!(command.contains("Extra instructions"));
    }

    #[test]
    fn test_build_agent_command_claude_with_session_management() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            resume: Some("abc123".to_string()),
            session_id: Some("123e4567-e89b-12d3-a456-426614174000".to_string()),
            fork_session: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--resume"));
        assert!(command.contains("abc123"));
        assert!(command.contains("--session-id"));
        assert!(command.contains("123e4567-e89b-12d3-a456-426614174000"));
        assert!(command.contains("--fork-session"));
    }

    #[test]
    fn test_build_agent_command_claude_with_verbose_streaming() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            verbose: true,
            replay_user_messages: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--verbose"));
        assert!(command.contains("--replay-user-messages"));
    }

    #[test]
    fn test_build_agent_command_claude_raw_passthrough() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Hello".to_string()),
            executable: Some("/opt/Claude Code/bin/claude".to_string()),
            extra_env: vec![
                (
                    "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC".to_string(),
                    "1".to_string(),
                ),
                ("MCP_TIMEOUT".to_string(), "10000".to_string()),
            ],
            extra_args: vec![
                "--mcp-config".to_string(),
                "/tmp/mcp config.json".to_string(),
                "--permission-mode".to_string(),
                "default".to_string(),
            ],
            skip_default_safety_flags: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("env"));
        assert!(command.contains("CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1"));
        assert!(command.contains("MCP_TIMEOUT=10000"));
        assert!(command.contains("/opt/Claude Code/bin/claude"));
        assert!(command.contains("--mcp-config"));
        assert!(command.contains("/tmp/mcp config.json"));
        assert!(command.contains("--permission-mode"));
        assert!(command.contains("default"));
        assert!(!command.contains("--dangerously-skip-permissions"));
    }

    #[test]
    fn test_build_agent_command_qwen_raw_passthrough() {
        let options = AgentCommandOptions {
            tool: "qwen".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt_file: Some("/tmp/prompt.txt".to_string()),
            executable: Some("/opt/qwen code/qwen".to_string()),
            extra_env: vec![("QWEN_HOME".to_string(), "/tmp/qwen home".to_string())],
            extra_args: vec![
                "--checkpointing".to_string(),
                "--approval-mode".to_string(),
                "default".to_string(),
            ],
            skip_default_safety_flags: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("cat"));
        assert!(command.contains("/tmp/prompt.txt"));
        assert!(command.contains("| env QWEN_HOME="));
        assert!(command.contains("/tmp/qwen home"));
        assert!(command.contains("/opt/qwen code/qwen"));
        assert!(command.contains("--checkpointing"));
        assert!(command.contains("--approval-mode"));
        assert!(command.contains("default"));
        assert!(!command.contains("--yolo"));
    }

    #[test]
    fn test_build_agent_command_gemini_raw_passthrough() {
        let options = AgentCommandOptions {
            tool: "gemini".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt_file: Some("/tmp/prompt.txt".to_string()),
            executable: Some("/opt/gemini cli/gemini".to_string()),
            extra_env: vec![("GEMINI_HOME".to_string(), "/tmp/gemini home".to_string())],
            extra_args: vec!["--telemetry".to_string(), "false".to_string()],
            skip_default_safety_flags: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("cat"));
        assert!(command.contains("/tmp/prompt.txt"));
        assert!(command.contains("| env GEMINI_HOME="));
        assert!(command.contains("/tmp/gemini home"));
        assert!(command.contains("/opt/gemini cli/gemini"));
        assert!(command.contains("--telemetry"));
        assert!(command.contains("false"));
        assert!(!command.contains("--yolo"));
    }

    #[test]
    fn test_build_agent_command_unknown_tool() {
        let options = AgentCommandOptions {
            tool: "unknown-tool".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Hello".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("bash -c"));
        assert!(command.contains("unknown-tool"));
        assert!(command.contains("--prompt"));
    }

    #[test]
    fn test_build_agent_command_screen_isolation() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            isolation: "screen".to_string(),
            screen_name: Some("my-session".to_string()),
            detached: true,
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("screen"));
        assert!(command.contains("-dmS"));
        assert!(command.contains("my-session"));
    }

    #[test]
    fn test_build_agent_command_docker_isolation() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            isolation: "docker".to_string(),
            container_name: Some("my-container".to_string()),
            detached: true,
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("docker run"));
        assert!(command.contains("-d"));
        assert!(command.contains("--name \"my-container\""));
        assert!(command.contains("-v \"/tmp/test:/tmp/test\""));
    }

    #[test]
    fn test_build_agent_command_with_model() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            model: Some("opus".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--model"));
        assert!(command.contains("claude-opus-4-7"));
    }

    #[test]
    fn test_build_agent_command_codex() {
        let options = AgentCommandOptions {
            tool: "codex".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Hello".to_string()),
            json: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("codex"));
        assert!(command.contains("exec"));
        assert!(command.contains("--json"));
    }

    #[test]
    fn test_build_agent_command_codex_prompt_file() {
        let inline_prompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
        let options = AgentCommandOptions {
            tool: "codex".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some(inline_prompt.to_string()),
            system_prompt: Some("System instructions".to_string()),
            prompt_file: Some("/tmp/agent prompt.txt".to_string()),
            json: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("cat"));
        assert!(command.contains("/tmp/agent prompt.txt"));
        assert!(command.contains("codex"));
        assert!(!command.contains(inline_prompt));
        assert!(!command.contains("System instructions"));
    }

    #[test]
    fn test_build_agent_command_claude_prompt_file() {
        let inline_prompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some(inline_prompt.to_string()),
            system_prompt: Some("You are helpful".to_string()),
            prompt_file: Some("/tmp/agent prompt.txt".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("cat"));
        assert!(command.contains("/tmp/agent prompt.txt"));
        assert!(command.contains("claude"));
        assert!(command.contains("--system-prompt"));
        assert!(command.contains("You are helpful"));
        assert!(!command.contains(inline_prompt));
    }

    #[test]
    fn test_build_agent_command_qwen_prompt_file() {
        let inline_prompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
        let options = AgentCommandOptions {
            tool: "qwen".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some(inline_prompt.to_string()),
            system_prompt: Some("System instructions".to_string()),
            prompt_file: Some("/tmp/agent prompt.txt".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("cat"));
        assert!(command.contains("/tmp/agent prompt.txt"));
        assert!(command.contains("qwen"));
        assert!(!command.contains(inline_prompt));
        assert!(!command.contains("System instructions"));
    }

    #[test]
    fn test_build_agent_command_gemini_prompt_file() {
        let inline_prompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
        let options = AgentCommandOptions {
            tool: "gemini".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some(inline_prompt.to_string()),
            system_prompt: Some("System instructions".to_string()),
            prompt_file: Some("/tmp/agent prompt.txt".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("cat"));
        assert!(command.contains("/tmp/agent prompt.txt"));
        assert!(command.contains("gemini"));
        assert!(!command.contains(inline_prompt));
        assert!(!command.contains("System instructions"));
    }

    #[test]
    fn test_build_agent_command_opencode() {
        let options = AgentCommandOptions {
            tool: "opencode".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Hello".to_string()),
            json: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("opencode"));
        assert!(command.contains("run"));
        assert!(command.contains("--format"));
    }

    #[test]
    fn test_build_agent_command_agent_tool() {
        let options = AgentCommandOptions {
            tool: "agent".to_string(),
            working_directory: "/tmp/test".to_string(),
            model: Some("grok".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("agent"));
        assert!(command.contains("--model"));
        assert!(command.contains("opencode/grok-code"));
    }

    #[test]
    fn test_build_agent_command_claude_read_only() {
        let options = AgentCommandOptions {
            tool: "claude".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Plan only".to_string()),
            read_only: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--permission-mode"));
        assert!(command.contains("plan"));
        assert!(!command.contains("--dangerously-skip-permissions"));
    }

    #[test]
    fn test_build_agent_command_codex_read_only() {
        let options = AgentCommandOptions {
            tool: "codex".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Plan only".to_string()),
            read_only: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("codex --ask-for-approval never exec"));
        assert!(command.contains("--sandbox"));
        assert!(command.contains("read-only"));
        assert!(!command.contains("--dangerously-bypass-approvals-and-sandbox"));
    }

    #[test]
    fn test_build_agent_command_opencode_read_only() {
        let options = AgentCommandOptions {
            tool: "opencode".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Plan only".to_string()),
            read_only: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("OPENCODE_PERMISSION="));
        assert!(command.contains("bash"));
        assert!(command.contains("edit"));
        assert!(command.contains("deny"));
    }

    #[test]
    fn test_build_agent_command_agent_read_only_uses_readonly_mode() {
        let options = AgentCommandOptions {
            tool: "agent".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Inspect only".to_string()),
            read_only: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--permission-mode"));
        assert!(command.contains("readonly"));
        assert!(!command.contains("plan"));
    }

    #[test]
    fn test_build_agent_command_agent_plan_only_uses_plan_mode() {
        let options = AgentCommandOptions {
            tool: "agent".to_string(),
            working_directory: "/tmp/test".to_string(),
            prompt: Some("Plan only".to_string()),
            plan_only: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let command = build_agent_command(&options);
        assert!(command.contains("--permission-mode"));
        assert!(command.contains("plan"));
        assert!(!command.contains("readonly"));
    }

    #[test]
    #[should_panic(expected = "does not support enforceable read-only mode")]
    fn test_build_agent_command_read_only_rejects_unknown_tool() {
        let options = AgentCommandOptions {
            tool: "unknown-tool".to_string(),
            working_directory: "/tmp/test".to_string(),
            read_only: true,
            isolation: "none".to_string(),
            ..Default::default()
        };

        let _command = build_agent_command(&options);
    }

    #[test]
    fn test_build_screen_stop_command() {
        let command = build_screen_stop_command("my-session");
        assert!(command.contains("screen"));
        assert!(command.contains("-S \"my-session\""));
        assert!(command.contains("-X quit"));
    }

    #[test]
    fn test_build_docker_stop_command() {
        let command = build_docker_stop_command("my-container");
        assert!(command.contains("docker stop \"my-container\""));
        assert!(command.contains("docker rm \"my-container\""));
    }

    #[test]
    fn test_build_piped_command_basic() {
        let command = build_piped_command("Hello World", "mycommand --flag");
        assert!(command.contains("printf '%s'"));
        assert!(command.contains("Hello World"));
        assert!(command.contains("mycommand --flag"));
    }

    #[test]
    fn test_build_piped_command_escapes_quotes() {
        let command = build_piped_command("It's working", "mycommand");
        assert!(command.contains("'\\''"));
    }
}
