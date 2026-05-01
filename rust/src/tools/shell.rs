//! Shared shell helpers for tool command builders.

/// Escape an argument for shell usage.
pub fn escape_arg(arg: &str) -> String {
    if arg.contains('"')
        || arg.contains(char::is_whitespace)
        || arg.contains('$')
        || arg.contains('`')
        || arg.contains('\\')
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

/// Escape single quotes for printf.
pub fn escape_single_quotes(s: &str) -> String {
    s.replace('\'', "'\\''")
}

fn is_valid_env_name(name: &str) -> bool {
    let mut chars = name.chars();
    let Some(first) = chars.next() else {
        return false;
    };
    if first != '_' && !first.is_ascii_alphabetic() {
        return false;
    }
    chars.all(|c| c == '_' || c.is_ascii_alphanumeric())
}

/// Build a command head with optional env vars and executable prefix args.
pub fn build_command_head(
    executable: &str,
    extra_env: &[(String, String)],
    prefix_args: &[String],
) -> String {
    let mut parts = Vec::new();

    if !extra_env.is_empty() {
        parts.push("env".to_string());
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
