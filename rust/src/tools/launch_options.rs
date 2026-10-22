//! Launch options shared by every tool (issue #57).
//!
//! Reasoning effort, MCP servers, extra workspace directories and file
//! attachments. Each tool maps them onto its own native flag; a tool without a native flag rejects the option instead of
//! silently dropping it.

use serde_json::Value;

/// Launch options shared by every tool
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct LaunchOptions {
    /// Native reasoning effort / variant level (`--reasoning-effort`)
    pub reasoning_effort: Option<String>,
    /// MCP servers: config file path or inline `{"mcpServers": {...}}` JSON
    pub mcp_config: Option<String>,
    /// Use only the servers from `mcp_config`
    pub strict_mcp_config: bool,
    /// Extra directories the agent may access (`--add-dir`)
    pub additional_directories: Vec<String>,
    /// Files attached to the prompt (`--attach`): Codex `--image`, OpenCode
    /// `--file`. Relative paths resolve against the working directory.
    pub attachments: Vec<String>,
}

/// What a tool natively supports among the launch options
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct LaunchCapabilities {
    pub reasoning_effort: bool,
    /// Documented effort levels; `None` when the tool or provider defines them
    pub reasoning_efforts: Option<&'static [&'static str]>,
    pub mcp_config: bool,
    pub strict_mcp_config: bool,
    pub additional_directories: bool,
    pub attachments: bool,
}

/// Claude Code `--effort` levels
pub const CLAUDE_REASONING_EFFORTS: &[&str] = &["low", "medium", "high", "xhigh", "max"];

/// Codex `model_reasoning_effort` levels
pub const CODEX_REASONING_EFFORTS: &[&str] = &["none", "minimal", "low", "medium", "high", "xhigh"];

const TOOLS: &[&str] = &["claude", "codex", "opencode", "agent", "gemini", "qwen"];

/// Describe what a tool natively supports among the launch options.
pub fn launch_capabilities(tool: &str) -> LaunchCapabilities {
    let (effort, efforts, mcp, strict, dirs, attachments) = match tool {
        "claude" => (
            true,
            Some(CLAUDE_REASONING_EFFORTS),
            true,
            true,
            true,
            false,
        ),
        "codex" => (true, Some(CODEX_REASONING_EFFORTS), true, false, true, true),
        // `--variant` names are defined by the model provider.
        "opencode" => (true, None, false, false, false, true),
        "gemini" => (false, None, false, false, true, false),
        "qwen" => (false, None, true, false, true, false),
        _ => (false, None, false, false, false, false),
    };
    LaunchCapabilities {
        reasoning_effort: effort,
        reasoning_efforts: efforts,
        mcp_config: mcp,
        strict_mcp_config: strict,
        additional_directories: dirs,
        attachments,
    }
}

/// Check that every requested launch option has a native flag in the tool.
///
/// # Errors
/// Returns the message naming the tools that do support the option.
pub fn check_launch_options_supported(tool: &str, launch: &LaunchOptions) -> Result<(), String> {
    check_launch_options_against(tool, launch, &launch_capabilities(tool))
}

/// Check the requested launch options against the given capabilities, such
/// as a `ToolOverrides::launch_capabilities` replacement.
///
/// # Errors
/// Returns the message naming the tools that do support the option.
pub fn check_launch_options_against(
    tool: &str,
    launch: &LaunchOptions,
    capabilities: &LaunchCapabilities,
) -> Result<(), String> {
    type Pick = fn(&LaunchCapabilities) -> bool;
    let checks: [(bool, Pick, &str); 5] = [
        (
            launch.reasoning_effort.is_some(),
            |c| c.reasoning_effort,
            "reasoning effort (--reasoning-effort)",
        ),
        (
            launch.mcp_config.is_some(),
            |c| c.mcp_config,
            "MCP server configuration (--mcp-config)",
        ),
        (
            launch.strict_mcp_config,
            |c| c.strict_mcp_config,
            "strict MCP configuration (--strict-mcp-config)",
        ),
        (
            !launch.additional_directories.is_empty(),
            |c| c.additional_directories,
            "additional directories (--add-dir)",
        ),
        (
            !launch.attachments.is_empty(),
            |c| c.attachments,
            "file attachments (--attach)",
        ),
    ];
    for (requested, pick, label) in checks {
        if requested && !pick(capabilities) {
            let supporting: Vec<&str> = TOOLS
                .iter()
                .copied()
                .filter(|name| pick(&launch_capabilities(name)))
                .collect();
            return Err(format!(
                "Tool \"{}\" does not support {}. Choose one of: {}; or omit the option.",
                tool,
                label,
                supporting.join(", ")
            ));
        }
    }
    Ok(())
}

/// Validate a reasoning effort / variant name.
///
/// # Panics
/// Panics when the level contains characters other than `[A-Za-z0-9_-]`.
pub fn normalize_reasoning_effort(reasoning_effort: &str) -> String {
    assert!(
        !reasoning_effort.is_empty()
            && reasoning_effort
                .chars()
                .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-'),
        "Invalid reasoning effort \"{}\". Use a level name such as low, medium or high.",
        reasoning_effort
    );
    reasoning_effort.to_string()
}

fn push_paths(args: &mut Vec<String>, flag: &str, paths: &[String], name: &str) {
    for path in paths {
        assert!(!path.is_empty(), "{name} must not be empty");
        args.push(flag.to_string());
        args.push(path.clone());
    }
}

/// Push `flag value` for each extra directory.
pub fn push_directories(args: &mut Vec<String>, flag: &str, directories: &[String]) {
    push_paths(args, flag, directories, "additional directories");
}

/// Push `flag file` for each attachment; a repeated flag keeps variadic
/// flags (Codex `--image`, OpenCode `--file`) from swallowing other values.
pub fn push_attachments(args: &mut Vec<String>, flag: &str, attachments: &[String]) {
    push_paths(args, flag, attachments, "attachments");
}

/// Encode a TOML key segment (bare when possible, quoted otherwise).
fn toml_key(key: &str) -> String {
    if !key.is_empty()
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
    {
        key.to_string()
    } else {
        Value::String(key.to_string()).to_string()
    }
}

/// Encode a JSON value as an inline TOML value. JSON string escapes are a
/// subset of TOML basic-string escapes, so strings reuse JSON encoding.
///
/// # Errors
/// Returns an error for `null` at the top level.
pub fn to_toml_value(value: &Value) -> Result<String, String> {
    match value {
        Value::String(_) | Value::Number(_) | Value::Bool(_) => Ok(value.to_string()),
        Value::Array(items) => {
            let parts: Result<Vec<String>, String> = items.iter().map(to_toml_value).collect();
            Ok(format!("[{}]", parts?.join(", ")))
        }
        Value::Object(map) => {
            let mut parts = Vec::new();
            for (key, item) in map.iter().filter(|(_, item)| !item.is_null()) {
                parts.push(format!("{} = {}", toml_key(key), to_toml_value(item)?));
            }
            Ok(format!("{{{}}}", parts.join(", ")))
        }
        Value::Null => Err("Cannot encode null as a TOML value".to_string()),
    }
}

/// Translate a Claude-style `{"mcpServers": {...}}` JSON document into one
/// Codex `-c mcp_servers={...}` override.
///
/// `headers` becomes `http_headers`
/// and the transport `type` is dropped (Codex infers it from `command` or
/// `url`). Codex merges the table into the servers from `config.toml`.
///
/// # Errors
/// Returns an error for a file path, invalid JSON or a missing `mcpServers`.
pub fn codex_mcp_servers_override(mcp_config: &str) -> Result<String, String> {
    if !mcp_config.trim_start().starts_with('{') {
        return Err("Tool \"codex\" takes MCP servers as config overrides, not a file path. Pass mcpConfig as inline JSON.".to_string());
    }
    let config: Value = serde_json::from_str(mcp_config)
        .map_err(|error| format!("Invalid mcpConfig JSON: {error}"))?;
    let servers = config
        .get("mcpServers")
        .and_then(Value::as_object)
        .ok_or_else(|| "mcpConfig must contain an mcpServers object".to_string())?;
    let mut table = serde_json::Map::new();
    for (name, server) in servers {
        let mut server = server
            .as_object()
            .cloned()
            .ok_or_else(|| format!("MCP server \"{name}\" must be an object"))?;
        server.remove("type");
        if let Some(headers) = server.remove("headers") {
            server.insert("http_headers".to_string(), headers);
        }
        table.insert(name.clone(), Value::Object(server));
    }
    Ok(format!(
        "mcp_servers={}",
        to_toml_value(&Value::Object(table))?
    ))
}
