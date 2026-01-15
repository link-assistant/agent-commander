//! Tests for streaming utilities

use agent_commander::streaming::{
    create_input_stream, create_output_stream, parse_ndjson, parse_ndjson_line, stringify_ndjson,
    stringify_ndjson_line,
};
use serde_json::json;

#[test]
fn test_create_output_stream() {
    let stream = create_output_stream();
    assert_eq!(stream.get_messages().len(), 0);
}

#[test]
fn test_create_input_stream() {
    let stream = create_input_stream(true);
    assert_eq!(stream.size(), 0);
}

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
    let value = serde_json::Value::Null;
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

#[test]
fn test_parse_ndjson_with_empty_lines() {
    let data = "{\"a\":1}\n\n{\"b\":2}\n";
    let result = parse_ndjson(data);
    assert_eq!(result.len(), 2);
}

#[test]
fn test_parse_ndjson_with_non_json_lines() {
    let data = "{\"a\":1}\nhello world\n{\"b\":2}\n";
    let result = parse_ndjson(data);
    assert_eq!(result.len(), 2);
}

#[test]
fn test_stringify_ndjson_line_pretty() {
    let value = json!({"type": "message"});
    let result = stringify_ndjson_line(&value, false);
    assert!(result.contains("type"));
    assert!(result.contains("message"));
    assert!(result.ends_with('\n'));
}

#[test]
fn test_output_stream_process_and_flush() {
    let mut stream = create_output_stream();
    stream.process("{\"type\":\"message\"}\n{\"type\":\"done\"}\n");
    stream.flush();
    let messages = stream.get_messages();
    assert_eq!(messages.len(), 2);
    assert_eq!(messages[0]["type"], "message");
    assert_eq!(messages[1]["type"], "done");
}

#[test]
fn test_input_stream_add_and_read() {
    let mut stream = create_input_stream(true);
    stream.add(json!({"type": "user_message", "content": "Hello"}));
    assert_eq!(stream.size(), 1);
    let output = stream.to_string();
    assert!(output.contains("user_message"));
}
