//! NDJSON (Newline Delimited JSON) utilities
//! https://github.com/ndjson/ndjson-spec

use serde_json::Value;

/// Parse a single NDJSON line
///
/// # Arguments
/// * `line` - Line to parse
///
/// # Returns
/// Parsed JSON value or None if invalid
pub fn parse_ndjson_line(line: &str) -> Option<Value> {
    let trimmed = line.trim();

    // Empty lines are ignored in NDJSON
    if trimmed.is_empty() {
        return None;
    }

    // Must start with { or [ to be valid JSON
    if !trimmed.starts_with('{') && !trimmed.starts_with('[') {
        return None;
    }

    serde_json::from_str(trimmed).ok()
}

/// Stringify an object to NDJSON line
///
/// # Arguments
/// * `value` - Value to stringify
/// * `compact` - Use compact JSON (no indentation)
///
/// # Returns
/// NDJSON line with trailing newline
pub fn stringify_ndjson_line(value: &Value, compact: bool) -> String {
    if value.is_null() {
        return String::new();
    }

    let json = if compact {
        serde_json::to_string(value).unwrap_or_default()
    } else {
        serde_json::to_string_pretty(value).unwrap_or_default()
    };

    format!("{}\n", json)
}

/// Parse multiple NDJSON lines
///
/// # Arguments
/// * `data` - Data containing multiple lines
///
/// # Returns
/// Vector of parsed JSON values
pub fn parse_ndjson(data: &str) -> Vec<Value> {
    data.lines()
        .filter_map(|line| parse_ndjson_line(line))
        .collect()
}

/// Stringify multiple objects to NDJSON
///
/// # Arguments
/// * `values` - Values to stringify
/// * `compact` - Use compact JSON
///
/// # Returns
/// NDJSON string
pub fn stringify_ndjson(values: &[Value], compact: bool) -> String {
    values
        .iter()
        .map(|v| stringify_ndjson_line(v, compact))
        .collect()
}

// Tests are in rust/tests/streaming_tests.rs
