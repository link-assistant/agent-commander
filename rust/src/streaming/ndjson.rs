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

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_parse_ndjson_line_valid_object() {
        let result = parse_ndjson_line(r#"{"type":"message"}"#);
        assert_eq!(result, Some(json!({"type": "message"})));
    }

    #[test]
    fn test_parse_ndjson_line_valid_array() {
        let result = parse_ndjson_line("[1, 2, 3]");
        assert_eq!(result, Some(json!([1, 2, 3])));
    }

    #[test]
    fn test_parse_ndjson_line_empty() {
        assert_eq!(parse_ndjson_line(""), None);
        assert_eq!(parse_ndjson_line("   "), None);
    }

    #[test]
    fn test_parse_ndjson_line_non_json() {
        assert_eq!(parse_ndjson_line("hello world"), None);
        assert_eq!(parse_ndjson_line("123"), None);
    }

    #[test]
    fn test_parse_ndjson_line_invalid_json() {
        assert_eq!(parse_ndjson_line("{invalid}"), None);
    }

    #[test]
    fn test_parse_ndjson_line_trims_whitespace() {
        let result = parse_ndjson_line(r#"  {"type":"message"}  "#);
        assert_eq!(result, Some(json!({"type": "message"})));
    }

    #[test]
    fn test_stringify_ndjson_line_object() {
        let value = json!({"type": "message"});
        let result = stringify_ndjson_line(&value, true);
        assert_eq!(result, "{\"type\":\"message\"}\n");
    }

    #[test]
    fn test_stringify_ndjson_line_null() {
        let value = Value::Null;
        let result = stringify_ndjson_line(&value, true);
        assert_eq!(result, "");
    }

    #[test]
    fn test_parse_ndjson() {
        let data = "{\"a\":1}\n{\"b\":2}\n";
        let result = parse_ndjson(data);
        assert_eq!(result.len(), 2);
        assert_eq!(result[0], json!({"a": 1}));
        assert_eq!(result[1], json!({"b": 2}));
    }

    #[test]
    fn test_stringify_ndjson() {
        let values = vec![json!({"a": 1}), json!({"b": 2})];
        let result = stringify_ndjson(&values, true);
        assert_eq!(result, "{\"a\":1}\n{\"b\":2}\n");
    }
}
