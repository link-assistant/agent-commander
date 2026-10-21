//! Balanced JSON record parsing (pretty-printed agent output, hive-mind#2119)

use agent_commander::streaming::{parse_json_records, JsonOutputStream, JsonRecordScanner};
use agent_commander::tools::agent;
use agent_commander::{build_normalized_result_metadata, BuildMetadataOptions};
use serde_json::{json, Value};

fn events() -> Vec<Value> {
    vec![
        json!({"type": "step_start", "sessionID": "ses_pretty", "part": {"type": "step-start"}}),
        json!({"type": "text", "sessionID": "ses_pretty", "part": {"type": "text", "text": "{ok}"}}),
        json!({"type": "step_finish", "sessionID": "ses_pretty", "part": {
            "type": "step-finish", "reason": "stop", "tokens": {"input": 7, "output": 3}
        }}),
    ]
}

/// `agent` without `--compact-json` prints indented records.
fn pretty() -> String {
    events()
        .iter()
        .map(|event| serde_json::to_string_pretty(event).unwrap())
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn reads_ndjson_pretty_printed_and_concatenated_records() {
    assert_eq!(parse_json_records(&pretty()), events());
    assert_eq!(
        parse_json_records("{\"a\":1}{\"b\":2}\n[3]"),
        vec![json!({"a": 1}), json!({"b": 2}), json!([3])]
    );
    assert_eq!(
        parse_json_records("[INFO] ready {x}\n{\"a\":\"}{\"}\nplain"),
        vec![json!({"a": "}{"})]
    );
}

#[test]
fn an_unterminated_record_does_not_hide_later_records() {
    assert_eq!(
        parse_json_records("{\"cut\":\n{\"a\":1}\n"),
        vec![json!({"a": 1})]
    );
}

#[test]
fn scanner_keeps_a_record_split_across_chunks_until_it_balances() {
    let mut scanner = JsonRecordScanner::new();
    assert_eq!(scanner.write("{\"type\":\n  \"te"), vec![]);
    let events = scanner.write("xt\"}\nnext line\n");
    assert_eq!(
        events[0],
        agent_commander::JsonRecordEvent::Json {
            value: json!({"type": "text"}),
            raw: "{\"type\":\n  \"text\"}".to_string(),
        }
    );
    assert_eq!(scanner.flush(), vec![]);
}

#[test]
fn output_stream_parses_pretty_printed_records_line_by_line() {
    let mut stream = JsonOutputStream::new();
    let received: Vec<Value> = pretty()
        .split('\n')
        .flat_map(|line| stream.process(&format!("{line}\n")))
        .collect();
    assert_eq!(received, events());
}

#[test]
fn agent_metadata_is_complete_for_default_pretty_printed_output() {
    let output = pretty();
    let parsed = agent::parse_output(&output);
    assert_eq!(
        agent::extract_session_id(&output).as_deref(),
        Some("ses_pretty")
    );
    assert_eq!(agent::extract_usage(&output).input_tokens, 7);
    let metadata = build_normalized_result_metadata(BuildMetadataOptions {
        tool: "agent",
        exit_code: 0,
        plain_output: &output,
        parsed_output: Some(&parsed),
        session_id: None,
        usage: None,
        ..Default::default()
    });
    assert!(metadata.success);
    assert_eq!(metadata.session_id.as_deref(), Some("ses_pretty"));
}
