//! @link-assistant/agent error classification ported from Hive Mind
//! (hive-mind#2141, #3213, #3570; issue #55); mirrors js/test/agent-errors.test.mjs.

use agent_commander::tools::agent::detect_errors;
use agent_commander::{build_normalized_result_metadata, BuildMetadataOptions, ResultMetadata};
use serde_json::{json, Value};

fn lines(events: &[Value]) -> String {
    events
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

fn failed_read_part() -> Value {
    json!({
        "type": "tool",
        "tool": "read",
        "state": { "status": "error", "error": "Error: File not found: /repo/e.g" }
    })
}

fn metadata(exit_code: i32, plain_output: &str) -> ResultMetadata {
    build_normalized_result_metadata(BuildMetadataOptions {
        tool: "agent",
        exit_code,
        plain_output,
        parsed_output: None,
        session_id: None,
        usage: None,
    })
}

#[test]
fn failed_tool_calls_do_not_fail_a_completed_run() {
    let output = lines(&[
        json!({ "type": "step_start", "sessionID": "ses_tool" }),
        json!({ "type": "error", "part": failed_read_part(), "message": "Error: File not found: /repo/e.g" }),
        json!({ "type": "step_finish", "part": { "reason": "tool-calls" } }),
        json!({ "type": "step_start", "sessionID": "ses_tool" }),
        json!({ "type": "text", "part": { "text": "Done." } }),
        json!({ "type": "step_finish", "part": { "reason": "stop" } }),
    ]);
    let metadata = metadata(0, &output);

    assert!(metadata.success);
    assert!(!metadata.error_during_execution);
}

#[test]
fn the_last_fatal_error_is_reported_with_its_named_error_text() {
    let output = lines(&[
        json!({ "type": "error", "part": failed_read_part(), "message": "Error: File not found: /repo/e.g" }),
        json!({ "type": "step_finish", "part": { "reason": "tool-calls" } }),
        json!({
            "type": "error",
            "error": {
                "name": "ProviderAuthError",
                "data": { "message": "Formal AI provider rejected the request" }
            }
        }),
    ]);
    let detected = detect_errors(&output);

    assert!(detected.has_error);
    assert_eq!(detected.error_type.as_deref(), Some("ProviderAuthError"));
    assert_eq!(
        detected.message.as_deref(),
        Some("ProviderAuthError: Formal AI provider rejected the request")
    );
}

#[test]
fn a_fatal_model_log_record_fails_an_exit_0_run() {
    let output = lines(&[
        json!({
            "type": "log",
            "level": "error",
            "service": "session.prompt",
            "error": "ProviderModelNotFoundError",
            "hint": "Check that the model exists in the provider",
            "message": "Failed to initialize specified model - NOT falling back to default"
        }),
        json!({ "type": "session.idle" }),
    ]);
    let metadata = metadata(0, &output);

    assert!(!metadata.success);
    assert_eq!(
        metadata.error_type.as_deref(),
        Some("ProviderModelNotFoundError")
    );
    assert_eq!(
        metadata.error_message.as_deref(),
        Some("ProviderModelNotFoundError — Failed to initialize specified model - NOT falling back to default — hint: Check that the model exists in the provider")
    );
}

#[test]
fn weekly_limit_then_step_finish_reason_error() {
    for exit_code in [0, 1] {
        let output = lines(&[
            json!({ "type": "step_start", "sessionID": "ses_limit" }),
            json!({
                "type": "error",
                "error": {
                    "name": "APIError",
                    "data": { "message": "You've hit your weekly limit · resets 11am (UTC)" }
                }
            }),
            json!({ "type": "step_finish", "part": { "reason": "error" } }),
        ]);
        let metadata = metadata(exit_code, &output);

        assert!(!metadata.success, "exit {exit_code}");
        assert!(metadata.limit_reached, "exit {exit_code}");
        assert_eq!(metadata.limit_reset_time.as_deref(), Some("11:00 AM"));
        assert_eq!(metadata.limit_timezone.as_deref(), Some("UTC"));
        assert_eq!(metadata.error_type.as_deref(), Some("APIError"));
    }
}

#[test]
fn pretty_printed_error_records_are_classified() {
    let output = serde_json::to_string_pretty(&json!({
        "type": "error",
        "error": { "name": "RetryTimeoutExceededError", "data": {} }
    }))
    .unwrap();
    let detected = detect_errors(&output);

    assert!(detected.has_error);
    assert_eq!(
        detected.message.as_deref(),
        Some("RetryTimeoutExceededError")
    );
}
