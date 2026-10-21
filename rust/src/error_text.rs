//! Human-readable rendering of structured error payloads
//!
//! Agentic CLIs publish errors as objects: `@link-assistant/agent` emits
//! `NamedError.toObject()` (`{"name":"RetryTimeoutExceededError","data":{"message":"…"}}`).
//! Ported from Hive Mind `src/error-text.lib.mjs` (hive-mind#2141).

use serde_json::Value;

/// Default truncation budget for rendered error text
pub const MAX_ERROR_TEXT_LENGTH: usize = 2000;

const PLACEHOLDER_ERROR_TEXTS: [&str; 6] = [
    "[object object]",
    "[object error]",
    "undefined",
    "null",
    "{}",
    "[]",
];

const NESTED_KEYS: [&str; 11] = [
    "message",
    "data",
    "error",
    "reason",
    "cause",
    "detail",
    "details",
    "description",
    "hint",
    "result",
    "stderr",
];

fn is_placeholder(text: &str) -> bool {
    PLACEHOLDER_ERROR_TEXTS.contains(&text.trim().to_lowercase().as_str())
}

fn stringify_value(value: &Value, depth: usize) -> String {
    match value {
        Value::Null => String::new(),
        Value::String(text) => text.trim().to_string(),
        Value::Bool(_) | Value::Number(_) => value.to_string(),
        _ if depth > 4 => value.to_string(),
        Value::Array(values) => values
            .iter()
            .map(|entry| stringify_value(entry, depth + 1))
            .filter(|rendered| !rendered.is_empty())
            .collect::<Vec<_>>()
            .join("; "),
        Value::Object(map) => {
            let name = map
                .get("name")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|name| !name.is_empty());
            for key in NESTED_KEYS {
                let rendered = map
                    .get(key)
                    .map(|entry| stringify_value(entry, depth + 1))
                    .unwrap_or_default();
                if rendered.is_empty() || is_placeholder(&rendered) {
                    continue;
                }
                return match name {
                    Some(name) if rendered != name => format!("{name}: {rendered}"),
                    _ => rendered,
                };
            }
            if let Some(name) = name {
                return name.to_string();
            }
            if map.is_empty() {
                String::new()
            } else {
                value.to_string()
            }
        }
    }
}

/// Render any error payload as one readable line, never `[object Object]`
///
/// Returns `fallback` when nothing readable is found; text longer than
/// `max_length` characters is truncated.
pub fn stringify_error_value(value: &Value, max_length: usize, fallback: &str) -> String {
    let rendered = stringify_value(value, 0);
    if rendered.is_empty() || is_placeholder(&rendered) {
        return fallback.to_string();
    }
    if rendered.chars().count() > max_length {
        let truncated: String = rendered.chars().take(max_length).collect();
        return format!("{truncated}… (truncated)");
    }
    rendered
}

/// Pick the first readable rendering among candidate payloads
pub fn first_error_text(candidates: &[&Value], fallback: &str) -> String {
    candidates
        .iter()
        .map(|candidate| stringify_error_value(candidate, MAX_ERROR_TEXT_LENGTH, ""))
        .find(|rendered| !rendered.is_empty())
        .unwrap_or_else(|| fallback.to_string())
}
