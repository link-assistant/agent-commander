//! Build command strings for different agent tools

use crate::tools::{
    agent::{self, AgentBuildOptions},
    claude::{self, ClaudeBuildOptions},
    codex::{self, CodexBuildOptions},
    is_tool_supported,
    opencode::{self, OpencodeBuildOptions},
};

/// Agent command build options
#[derive(Debug, Clone, Default)]
pub struct AgentCommandOptions {
    pub tool: String,
    pub working_directory: String,
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub model: Option<String>,
    pub json: bool,
    pub resume: Option<String>,
    pub isolation: String,
    pub screen_name: Option<String>,
    pub container_name: Option<String>,
    pub detached: bool,
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
    // Build base command using tool-specific builder if available
    let base_command = if is_tool_supported(&options.tool) {
        match options.tool.as_str() {
            "claude" => claude::build_command(&ClaudeBuildOptions {
                prompt: options.prompt.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                json: options.json,
                resume: options.resume.clone(),
                print: false,
            }),
            "codex" => codex::build_command(&CodexBuildOptions {
                prompt: options.prompt.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                json: options.json,
                resume: options.resume.clone(),
            }),
            "opencode" => opencode::build_command(&OpencodeBuildOptions {
                prompt: options.prompt.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                json: options.json,
                resume: options.resume.clone(),
            }),
            "agent" => agent::build_command(&AgentBuildOptions {
                prompt: options.prompt.clone(),
                system_prompt: options.system_prompt.clone(),
                model: options.model.clone(),
                compact_json: false,
                use_existing_claude_oauth: false,
            }),
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
        assert!(command.contains("claude-opus-4-5-20251101"));
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
