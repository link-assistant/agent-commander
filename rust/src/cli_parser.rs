//! Parse CLI arguments
//! Simple argument parser without external dependencies

use std::collections::HashMap;

/// Parsed command line arguments
#[derive(Debug, Clone, Default)]
pub struct ParsedArgs {
    pub options: HashMap<String, String>,
    pub flags: Vec<String>,
    pub positional: Vec<String>,
}

impl ParsedArgs {
    /// Get an option value
    pub fn get(&self, key: &str) -> Option<&String> {
        self.options.get(key)
    }

    /// Check if a flag is set
    pub fn has_flag(&self, key: &str) -> bool {
        self.flags.contains(&key.to_string()) || self.options.contains_key(key)
    }

    /// Get an option as boolean (flag presence)
    pub fn get_bool(&self, key: &str) -> bool {
        self.has_flag(key)
    }
}

/// Parse command line arguments
///
/// # Arguments
/// * `args` - Process arguments
///
/// # Returns
/// Parsed options
pub fn parse_args(args: &[String]) -> ParsedArgs {
    let mut parsed = ParsedArgs::default();
    let mut i = 0;

    while i < args.len() {
        let arg = &args[i];

        if arg.starts_with("--") {
            let key = arg.trim_start_matches("--").to_string();
            let next_arg = args.get(i + 1);

            // Check if it's a flag (boolean) or has a value
            if let Some(next) = next_arg {
                if !next.starts_with("--") {
                    parsed.options.insert(key, next.clone());
                    i += 1; // Skip next arg as it's the value
                } else {
                    parsed.flags.push(key);
                }
            } else {
                parsed.flags.push(key);
            }
        } else {
            parsed.positional.push(arg.clone());
        }

        i += 1;
    }

    parsed
}

/// Start agent options
#[derive(Debug, Clone, Default)]
pub struct StartAgentOptions {
    pub tool: Option<String>,
    pub working_directory: Option<String>,
    pub prompt: Option<String>,
    pub system_prompt: Option<String>,
    pub append_system_prompt: Option<String>,
    pub model: Option<String>,
    pub fallback_model: Option<String>,
    pub verbose: bool,
    pub replay_user_messages: bool,
    pub resume: Option<String>,
    pub session_id: Option<String>,
    pub fork_session: bool,
    pub isolation: String,
    pub screen_name: Option<String>,
    pub container_name: Option<String>,
    pub dry_run: bool,
    pub detached: bool,
    pub attached: bool,
    pub help: bool,
}

/// Stop agent options
#[derive(Debug, Clone, Default)]
pub struct StopAgentOptions {
    pub isolation: Option<String>,
    pub screen_name: Option<String>,
    pub container_name: Option<String>,
    pub dry_run: bool,
    pub help: bool,
}

/// Parse start-agent CLI arguments
///
/// # Arguments
/// * `args` - Process arguments
///
/// # Returns
/// Parsed configuration
pub fn parse_start_agent_args(args: &[String]) -> StartAgentOptions {
    let parsed = parse_args(args);

    let detached = parsed.get_bool("detached");
    let isolation = parsed
        .get("isolation")
        .cloned()
        .unwrap_or_else(|| "none".to_string());

    StartAgentOptions {
        tool: parsed.get("tool").cloned(),
        working_directory: parsed.get("working-directory").cloned(),
        prompt: parsed.get("prompt").cloned(),
        system_prompt: parsed.get("system-prompt").cloned(),
        append_system_prompt: parsed.get("append-system-prompt").cloned(),
        model: parsed.get("model").cloned(),
        fallback_model: parsed.get("fallback-model").cloned(),
        verbose: parsed.get_bool("verbose"),
        replay_user_messages: parsed.get_bool("replay-user-messages"),
        resume: parsed.get("resume").cloned(),
        session_id: parsed.get("session-id").cloned(),
        fork_session: parsed.get_bool("fork-session"),
        isolation,
        screen_name: parsed.get("screen-name").cloned(),
        container_name: parsed.get("container-name").cloned(),
        dry_run: parsed.get_bool("dry-run"),
        detached,
        attached: !detached, // Default is attached unless detached is specified
        help: parsed.get_bool("help") || parsed.get_bool("h"),
    }
}

/// Parse stop-agent CLI arguments
///
/// # Arguments
/// * `args` - Process arguments
///
/// # Returns
/// Parsed configuration
pub fn parse_stop_agent_args(args: &[String]) -> StopAgentOptions {
    let parsed = parse_args(args);

    StopAgentOptions {
        isolation: parsed.get("isolation").cloned(),
        screen_name: parsed.get("screen-name").cloned(),
        container_name: parsed.get("container-name").cloned(),
        dry_run: parsed.get_bool("dry-run"),
        help: parsed.get_bool("help") || parsed.get_bool("h"),
    }
}

/// Show start-agent help message
pub fn show_start_agent_help() {
    println!(
        r#"
Usage: start-agent [options]

Options:
  --tool <name>                    CLI tool to use (e.g., 'claude') [required]
  --working-directory <path>       Working directory for the agent [required]
  --prompt <text>                  Prompt for the agent
  --system-prompt <text>           System prompt for the agent
  --append-system-prompt <text>    Append to the default system prompt
  --model <model>                  Model to use (e.g., 'sonnet', 'opus', 'haiku')
  --fallback-model <model>         Fallback model when default is overloaded
  --verbose                        Enable verbose mode
  --resume <sessionId>             Resume a previous session by ID
  --session-id <uuid>              Use a specific session ID (must be valid UUID)
  --fork-session                   Create new session ID when resuming
  --replay-user-messages           Re-emit user messages on stdout (streaming mode)
  --isolation <mode>               Isolation mode: none, screen, docker (default: none)
  --screen-name <name>             Screen session name (required for screen isolation)
  --container-name <name>          Container name (required for docker isolation)
  --detached                       Run in detached mode
  --dry-run                        Show command without executing
  --help, -h                       Show this help message

Examples:
  # Basic usage (no isolation)
  start-agent --tool claude --working-directory "/tmp/dir" --prompt "Hello"

  # With model selection
  start-agent --tool claude --working-directory "/tmp/dir" \
    --prompt "Hello" --model opus --fallback-model sonnet

  # Resume a session with fork
  start-agent --tool claude --working-directory "/tmp/dir" \
    --resume abc123 --fork-session

  # With screen isolation (detached)
  start-agent --tool claude --working-directory "/tmp/dir" \
    --isolation screen --screen-name my-agent --detached

  # With docker isolation (attached)
  start-agent --tool claude --working-directory "/tmp/dir" \
    --isolation docker --container-name my-container

  # Dry run
  start-agent --tool claude --working-directory "/tmp/dir" --dry-run
"#
    );
}

/// Show stop-agent help message
pub fn show_stop_agent_help() {
    println!(
        r#"
Usage: stop-agent [options]

Options:
  --isolation <mode>               Isolation mode: screen, docker [required]
  --screen-name <name>             Screen session name (required for screen isolation)
  --container-name <name>          Container name (required for docker isolation)
  --dry-run                        Show command without executing
  --help, -h                       Show this help message

Examples:
  # Stop screen session
  stop-agent --isolation screen --screen-name my-agent

  # Stop docker container
  stop-agent --isolation docker --container-name my-container

  # Dry run
  stop-agent --isolation screen --screen-name my-agent --dry-run
"#
    );
}

/// Validation result
#[derive(Debug, Clone)]
pub struct ValidationResult {
    pub valid: bool,
    pub errors: Vec<String>,
}

/// Validate start-agent options
///
/// # Arguments
/// * `options` - Parsed options
///
/// # Returns
/// Validation result with valid flag and errors
pub fn validate_start_agent_options(options: &StartAgentOptions) -> ValidationResult {
    let mut errors = Vec::new();

    if options.tool.is_none() {
        errors.push("--tool is required".to_string());
    }

    if options.working_directory.is_none() {
        errors.push("--working-directory is required".to_string());
    }

    if options.isolation == "screen" && options.screen_name.is_none() {
        errors.push("--screen-name is required for screen isolation".to_string());
    }

    if options.isolation == "docker" && options.container_name.is_none() {
        errors.push("--container-name is required for docker isolation".to_string());
    }

    if !["none", "screen", "docker"].contains(&options.isolation.as_str()) {
        errors.push("--isolation must be one of: none, screen, docker".to_string());
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
    }
}

/// Validate stop-agent options
///
/// # Arguments
/// * `options` - Parsed options
///
/// # Returns
/// Validation result with valid flag and errors
pub fn validate_stop_agent_options(options: &StopAgentOptions) -> ValidationResult {
    let mut errors = Vec::new();

    if options.isolation.is_none() {
        errors.push("--isolation is required".to_string());
    }

    if let Some(ref isolation) = options.isolation {
        if !["screen", "docker"].contains(&isolation.as_str()) {
            errors.push("--isolation must be one of: screen, docker".to_string());
        }

        if isolation == "screen" && options.screen_name.is_none() {
            errors.push("--screen-name is required for screen isolation".to_string());
        }

        if isolation == "docker" && options.container_name.is_none() {
            errors.push("--container-name is required for docker isolation".to_string());
        }
    }

    ValidationResult {
        valid: errors.is_empty(),
        errors,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_args_basic_flags() {
        let args: Vec<String> = vec!["--foo".into(), "bar".into(), "--baz".into()];
        let result = parse_args(&args);

        assert_eq!(result.get("foo"), Some(&"bar".to_string()));
        assert!(result.has_flag("baz"));
    }

    #[test]
    fn test_parse_args_with_positional() {
        let args: Vec<String> = vec!["--foo".into(), "bar".into(), "positional1".into()];
        let result = parse_args(&args);

        assert_eq!(result.get("foo"), Some(&"bar".to_string()));
        assert_eq!(result.positional, vec!["positional1"]);
    }

    #[test]
    fn test_parse_start_agent_args_basic() {
        let args: Vec<String> = vec![
            "--tool".into(),
            "claude".into(),
            "--working-directory".into(),
            "/tmp/test".into(),
            "--prompt".into(),
            "Hello".into(),
        ];
        let result = parse_start_agent_args(&args);

        assert_eq!(result.tool, Some("claude".to_string()));
        assert_eq!(result.working_directory, Some("/tmp/test".to_string()));
        assert_eq!(result.prompt, Some("Hello".to_string()));
        assert_eq!(result.isolation, "none");
    }

    #[test]
    fn test_parse_start_agent_args_with_isolation() {
        let args: Vec<String> = vec![
            "--tool".into(),
            "claude".into(),
            "--working-directory".into(),
            "/tmp/test".into(),
            "--isolation".into(),
            "screen".into(),
            "--screen-name".into(),
            "my-session".into(),
        ];
        let result = parse_start_agent_args(&args);

        assert_eq!(result.isolation, "screen");
        assert_eq!(result.screen_name, Some("my-session".to_string()));
    }

    #[test]
    fn test_parse_start_agent_args_dry_run() {
        let args: Vec<String> = vec![
            "--tool".into(),
            "claude".into(),
            "--working-directory".into(),
            "/tmp/test".into(),
            "--dry-run".into(),
        ];
        let result = parse_start_agent_args(&args);

        assert!(result.dry_run);
    }

    #[test]
    fn test_parse_stop_agent_args_screen() {
        let args: Vec<String> = vec![
            "--isolation".into(),
            "screen".into(),
            "--screen-name".into(),
            "my-session".into(),
        ];
        let result = parse_stop_agent_args(&args);

        assert_eq!(result.isolation, Some("screen".to_string()));
        assert_eq!(result.screen_name, Some("my-session".to_string()));
    }

    #[test]
    fn test_validate_start_agent_options_valid() {
        let options = StartAgentOptions {
            tool: Some("claude".to_string()),
            working_directory: Some("/tmp/test".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };
        let result = validate_start_agent_options(&options);

        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validate_start_agent_options_missing_tool() {
        let options = StartAgentOptions {
            working_directory: Some("/tmp/test".to_string()),
            isolation: "none".to_string(),
            ..Default::default()
        };
        let result = validate_start_agent_options(&options);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("tool")));
    }

    #[test]
    fn test_validate_start_agent_options_screen_without_name() {
        let options = StartAgentOptions {
            tool: Some("claude".to_string()),
            working_directory: Some("/tmp/test".to_string()),
            isolation: "screen".to_string(),
            ..Default::default()
        };
        let result = validate_start_agent_options(&options);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("screen-name")));
    }

    #[test]
    fn test_validate_stop_agent_options_valid() {
        let options = StopAgentOptions {
            isolation: Some("screen".to_string()),
            screen_name: Some("my-session".to_string()),
            ..Default::default()
        };
        let result = validate_stop_agent_options(&options);

        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validate_stop_agent_options_missing_isolation() {
        let options = StopAgentOptions::default();
        let result = validate_stop_agent_options(&options);

        assert!(!result.valid);
        assert!(result.errors.iter().any(|e| e.contains("isolation")));
    }
}
