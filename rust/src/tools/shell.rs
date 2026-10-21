//! Shared shell helpers for tool command builders.

/// Escape an argument for shell usage.
pub fn escape_arg(arg: &str) -> String {
    if arg.is_empty()
        || !arg
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "-_./:=+,@%".contains(c))
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

/// Escape single quotes for printf (command-stream's
/// [`escape_for_single_quotes`](command_stream::quote::escape_for_single_quotes)).
pub fn escape_single_quotes(s: &str) -> String {
    command_stream::quote::escape_for_single_quotes(s)
}

/// Look a model alias up, exactly first and then case-insensitively
/// (`Opus` is `opus`, as in Hive Mind).
pub fn lookup_model_alias(
    model_map: &std::collections::HashMap<&'static str, &'static str>,
    model: &str,
) -> Option<String> {
    model_map
        .get(model)
        .or_else(|| {
            model_map
                .iter()
                .find(|(alias, _)| alias.eq_ignore_ascii_case(model))
                .map(|(_, id)| id)
        })
        .map(|id| (*id).to_string())
}

pub fn is_valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first != '_' && !first.is_ascii_alphabetic() {
        return false;
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// Build a command head with optional env vars and executable prefix args;
/// `unset_env` is removed from the inherited environment (Hive Mind drops `GH_TOKEN`, `MAX_THINKING_TOKENS`, ... per run).
pub fn build_command_head(
    executable: &str,
    unset_env: &[String],
    extra_env: &[(String, String)],
    prefix_args: &[String],
) -> String {
    let mut parts = Vec::new();

    if !extra_env.is_empty() || !unset_env.is_empty() {
        parts.push("env".to_string());
        for key in unset_env {
            assert!(
                is_valid_env_name(key),
                "invalid environment variable name: {}",
                key
            );
            parts.push(format!("-u {key}"));
        }
        for (key, value) in extra_env {
            assert!(
                is_valid_env_name(key),
                "invalid environment variable name: {}",
                key
            );
            parts.push(format!("{}={}", key, escape_arg(value)));
        }
    }

    parts.push(escape_arg(executable));
    parts.extend(prefix_args.iter().map(|arg| escape_arg(arg)));
    parts.join(" ")
}
