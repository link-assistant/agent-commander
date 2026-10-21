//! Usage-limit detection ported from Hive Mind (issue #55); mirrors
//! js/test/usage-limit.test.mjs.

use agent_commander::{
    build_normalized_result_metadata, classify_rate_limit_event, extract_reset_time,
    extract_timezone, format_epoch_reset_time_utc, is_usage_limit_text, BuildMetadataOptions,
    ResultMetadata, UsageLimitVerdict,
};
use serde_json::{json, Value};

const WEEKLY_LIMIT: &str = "You've hit your weekly limit · resets 11am (UTC)";
const WEEKLY_RESET_EPOCH: i64 = 1_792_494_000; // 2026-10-20T11:00:00Z

const DEBUG_429_BLOCK: [&str; 14] = [
    "[log_be123b] response error (error; no more retries left) {",
    "  url: \"https://api.anthropic.com/v1/messages?beta=true\",",
    "  status: 429,",
    "  headers: {",
    "    \"anthropic-ratelimit-unified-5h-status\": \"allowed\",",
    "    \"anthropic-ratelimit-unified-7d-reset\": \"1792494000\",",
    "    \"anthropic-ratelimit-unified-7d-status\": \"rejected\",",
    "    \"anthropic-ratelimit-unified-representative-claim\": \"seven_day\",",
    "    \"anthropic-ratelimit-unified-reset\": \"1792494000\",",
    "    \"anthropic-ratelimit-unified-status\": \"rejected\",",
    "    \"retry-after\": \"56482\",",
    "  },",
    "  message: undefined,",
    "}",
];

fn lines(events: &[Value]) -> String {
    events
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

fn metadata(tool: &str, exit_code: i32, plain_output: &str) -> ResultMetadata {
    build_normalized_result_metadata(BuildMetadataOptions {
        tool,
        exit_code,
        plain_output,
        parsed_output: None,
        session_id: None,
        usage: None,
    })
}

#[test]
fn text_patterns_follow_hive_mind() {
    assert!(is_usage_limit_text("You've hit your usage limit."));
    assert!(is_usage_limit_text(WEEKLY_LIMIT));
    assert!(is_usage_limit_text("Session limit reached ∙ resets 5pm"));
    assert!(is_usage_limit_text("Limit resets Jan 15, 8am"));
    assert!(is_usage_limit_text("rate_limit_exceeded"));
    // A transient server throttle is not an account usage limit (hive-mind#1924).
    assert!(!is_usage_limit_text(
        "API Error: Rate limited (not your usage limit)"
    ));
    assert!(!is_usage_limit_text("loads a shell and resets the state"));
    assert!(!is_usage_limit_text("the counter resets monthly"));
}

#[test]
fn reset_times_are_normalized_for_hive_mind_parse_reset_time() {
    assert_eq!(
        extract_reset_time("You've hit your usage limit. Try again at Jun 11th, 2026 12:27 AM.")
            .as_deref(),
        Some("Jun 11, 2026, 12:27 AM")
    );
    assert_eq!(
        extract_reset_time("Limit reached · resets Jan 15, 8am (Europe/Berlin)").as_deref(),
        Some("Jan 15, 8:00 AM")
    );
    assert_eq!(
        extract_reset_time(WEEKLY_LIMIT).as_deref(),
        Some("11:00 AM")
    );
    assert_eq!(
        extract_reset_time("Limit reached, resets 17:30").as_deref(),
        Some("5:30 PM")
    );
    assert_eq!(
        extract_reset_time("Usage limit reached. Please try again at 2026-05-01 18:30 UTC.")
            .as_deref(),
        Some("2026-05-01 18:30 UTC")
    );
    assert_eq!(extract_timezone(WEEKLY_LIMIT, None).as_deref(), Some("UTC"));
    assert_eq!(
        extract_timezone("resets 8am (Europe/Berlin)", None).as_deref(),
        Some("Europe/Berlin")
    );
    // "AM" is not a timezone.
    assert_eq!(
        extract_timezone(
            "try again at Jun 11th, 2026 12:27 AM",
            Some("Jun 11th, 2026 12:27 AM")
        ),
        None
    );
    assert_eq!(
        format_epoch_reset_time_utc(WEEKLY_RESET_EPOCH).as_deref(),
        Some("Oct 20, 2026, 11:00 AM")
    );
}

#[test]
fn rate_limit_event_classification() {
    assert_eq!(
        classify_rate_limit_event(&json!({
            "status": "rejected",
            "resetsAt": WEEKLY_RESET_EPOCH,
            "rateLimitType": "seven_day"
        })),
        UsageLimitVerdict {
            reached: true,
            throttled: false,
            reset_time: Some("Oct 20, 2026, 11:00 AM".into()),
            timezone: Some("UTC".into()),
            resets_at: Some(WEEKLY_RESET_EPOCH),
            window: Some("seven_day".into()),
        }
    );
    // A warning below 100% is not a limit.
    assert!(
        !classify_rate_limit_event(&json!({
            "status": "allowed_warning",
            "resetsAt": WEEKLY_RESET_EPOCH,
            "utilization": 0.97
        }))
        .reached
    );
    // Exhausted without overage is a limit.
    assert!(
        classify_rate_limit_event(&json!({
            "status": "allowed",
            "resetsAt": WEEKLY_RESET_EPOCH,
            "utilization": 1,
            "overageStatus": "rejected"
        }))
        .reached
    );
    // Rejected without resetsAt is a throttle (hive-mind#1924).
    assert_eq!(
        classify_rate_limit_event(&json!({ "status": "rejected" })),
        UsageLimitVerdict {
            throttled: true,
            ..UsageLimitVerdict::default()
        }
    );
}

#[test]
fn codex_usage_limit_from_an_error_event() {
    let output = lines(&[
        json!({ "type": "thread.started", "thread_id": "thread-limit" }),
        json!({ "type": "turn.started" }),
        json!({
            "type": "error",
            "message": "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jun 11th, 2026 12:27 AM."
        }),
        json!({ "type": "turn.failed", "error": { "message": "stream disconnected before completion" } }),
    ]);
    let metadata = metadata("codex", 1, &output);

    assert!(!metadata.success);
    assert!(metadata.limit_reached);
    assert_eq!(
        metadata.limit_reset_time.as_deref(),
        Some("Jun 11, 2026, 12:27 AM")
    );
    assert_eq!(metadata.limit_timezone, None);
    assert_eq!(metadata.session_id.as_deref(), Some("thread-limit"));
}

#[test]
fn claude_rate_limit_event_epoch_beats_the_text_reset() {
    let output = lines(&[
        json!({ "type": "system", "subtype": "init", "session_id": "sess-week" }),
        json!({
            "type": "rate_limit_event",
            "rate_limit_info": {
                "status": "rejected",
                "resetsAt": WEEKLY_RESET_EPOCH,
                "rateLimitType": "seven_day"
            }
        }),
        json!({
            "type": "assistant",
            "is_api_error_message": true,
            "error": "rate_limit",
            "message": { "content": [{ "type": "text", "text": WEEKLY_LIMIT }] }
        }),
        json!({ "type": "result", "subtype": "success", "is_error": true, "result": WEEKLY_LIMIT }),
    ]);
    let metadata = metadata("claude", 1, &output);

    assert!(metadata.limit_reached);
    assert_eq!(
        metadata.limit_reset_time.as_deref(),
        Some("Oct 20, 2026, 11:00 AM")
    );
    assert_eq!(metadata.limit_timezone.as_deref(), Some("UTC"));
    assert_eq!(metadata.limit_resets_at, Some(WEEKLY_RESET_EPOCH));
    assert_eq!(metadata.limit_window.as_deref(), Some("seven_day"));
    assert_eq!(metadata.error_type.as_deref(), Some("rate_limit"));
    assert_eq!(metadata.error_message.as_deref(), Some(WEEKLY_LIMIT));

    let serialized = serde_json::to_value(&metadata).unwrap();
    assert_eq!(serialized["limitResetsAt"], WEEKLY_RESET_EPOCH);
    assert_eq!(serialized["limitWindow"], "seven_day");
}

#[test]
fn claude_weekly_limit_text_alone_keeps_the_11am_reset() {
    let output = json!({
        "type": "result",
        "subtype": "success",
        "is_error": true,
        "result": WEEKLY_LIMIT
    })
    .to_string();
    let metadata = metadata("claude", 1, &output);

    assert!(metadata.limit_reached);
    assert_eq!(metadata.limit_reset_time.as_deref(), Some("11:00 AM"));
    assert_eq!(metadata.limit_timezone.as_deref(), Some("UTC"));
    assert_eq!(metadata.limit_resets_at, None);
}

#[test]
fn debug_429_headers_identify_the_limit_and_are_not_the_error_message() {
    let base64_dump = "Cfl40YOZK5u33blnr31i3MxYfHT5zEUjKBjXrhm2/98OPPp89".repeat(4);
    let mut output =
        vec![json!({ "type": "system", "subtype": "init", "session_id": "s" }).to_string()];
    output.extend(DEBUG_429_BLOCK.iter().map(ToString::to_string));
    output.push(base64_dump);
    let metadata = metadata("claude", 1, &output.join("\n"));

    assert!(metadata.limit_reached);
    assert_eq!(
        metadata.limit_reset_time.as_deref(),
        Some("Oct 20, 2026, 11:00 AM")
    );
    assert_eq!(metadata.limit_timezone.as_deref(), Some("UTC"));
    assert_eq!(metadata.limit_window.as_deref(), Some("seven_day"));
    assert_eq!(
        metadata.error_message.as_deref(),
        Some("Process exited with code 1")
    );
}

#[test]
fn a_server_throttle_is_rate_limited_not_a_usage_limit() {
    let text =
        "API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited";
    let output = lines(&[
        json!({ "type": "rate_limit_event", "rate_limit_info": { "status": "rejected", "isUsingOverage": false } }),
        json!({ "type": "result", "subtype": "success", "is_error": true, "api_error_status": 429, "result": text }),
    ]);
    let metadata = metadata("claude", 1, &output);

    assert!(!metadata.limit_reached);
    assert!(!metadata.success);
    assert_eq!(metadata.error_type.as_deref(), Some("rate_limited"));
    assert_eq!(metadata.error_message.as_deref(), Some(text));
}

#[test]
fn tool_output_that_mentions_limits_is_not_a_usage_limit() {
    let output = lines(&[
        json!({ "type": "system", "subtype": "init", "session_id": "s" }),
        json!({
            "type": "user",
            "message": { "content": [{
                "type": "tool_result",
                "content": "docs: usage limit reached. Please try again at 5pm"
            }] }
        }),
        json!({
            "type": "assistant",
            "parent_tool_use_id": "toolu_1",
            "message": { "content": [{ "type": "text", "text": "Limit reached" }] }
        }),
    ]);

    assert!(!metadata("claude", 1, &output).limit_reached);
}

#[test]
fn api_error_usage_limit_reached_is_a_limit() {
    let output = json!({
        "type": "result",
        "subtype": "error_during_execution",
        "is_error": true,
        "api_error": "usage_limit_reached",
        "result": "Request failed"
    })
    .to_string();
    let metadata = metadata("claude", 1, &output);

    assert!(metadata.limit_reached);
    assert_eq!(metadata.limit_reset_time, None);
}
