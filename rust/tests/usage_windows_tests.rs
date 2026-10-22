//! Tests for normalized usage windows (issue #57).

use agent_commander::{
    apply_codex_rollout_usage_windows, build_normalized_result_metadata, claude_rate_limit_windows,
    codex_rate_limit_windows, extract_usage_windows, merge_usage_windows, BuildMetadataOptions,
    CodexRolloutOptions, ResultMetadata, UsageWindow,
};
use serde_json::{json, Value};

fn rate_limit_event(info: &Value) -> Value {
    json!({"type": "rate_limit_event", "rate_limit_info": info})
}

fn window(
    id: &str,
    kind: &str,
    label: &str,
    used: f64,
    resets_at: Option<i64>,
    mins: Option<u64>,
) -> UsageWindow {
    UsageWindow {
        id: id.to_string(),
        kind: kind.to_string(),
        label: label.to_string(),
        used_percent: used,
        resets_at,
        window_duration_mins: mins,
    }
}

#[test]
fn claude_rate_limit_info_becomes_a_session_or_weekly_window() {
    assert_eq!(
        claude_rate_limit_windows(Some(&json!({
            "status": "allowed_warning",
            "rateLimitType": "five_hour",
            "utilization": 0.41,
            "resetsAt": 1_792_494_000
        }))),
        [window(
            "five_hour",
            "session",
            "Session",
            41.0,
            Some(1_792_494_000),
            Some(300)
        )]
    );
    assert_eq!(
        claude_rate_limit_windows(Some(
            &json!({"rateLimitType": "seven_day_opus", "utilization": 1.2})
        )),
        [window(
            "seven_day_opus",
            "weekly",
            "Weekly · opus",
            100.0,
            None,
            Some(10080)
        )]
    );
    assert_eq!(
        claude_rate_limit_windows(Some(
            &json!({"rateLimitType": "overage", "utilization": 0.5})
        ))[0]
            .kind,
        "other"
    );
    assert_eq!(
        claude_rate_limit_windows(Some(&json!({"status": "allowed"}))),
        []
    );
    assert_eq!(claude_rate_limit_windows(None), []);
}

#[test]
fn codex_rate_limits_become_windows_in_both_casings() {
    let rollout = json!({
        "limit_id": "codex",
        "primary": {"used_percent": 100, "window_minutes": 300, "resets_at": 1_792_494_000},
        "secondary": {"used_percent": 41, "window_minutes": 10080, "resets_at": 1_792_900_000}
    });
    assert_eq!(
        codex_rate_limit_windows(Some(&rollout)),
        [
            window(
                "primary",
                "session",
                "Session",
                100.0,
                Some(1_792_494_000),
                Some(300)
            ),
            window(
                "secondary",
                "weekly",
                "Weekly",
                41.0,
                Some(1_792_900_000),
                Some(10080)
            ),
        ]
    );
    // App-server casing, Free plan without a window length: monthly primary.
    assert_eq!(
        codex_rate_limit_windows(Some(&json!({
            "planType": "free",
            "primary": {"usedPercent": 12.5, "resetsAt": 1_793_000_000}
        }))),
        [window(
            "primary",
            "monthly",
            "Monthly",
            12.5,
            Some(1_793_000_000),
            Some(43200)
        )]
    );
    // A model-specific allowance must not replace the main windows.
    let mut spark = rollout;
    spark["limit_id"] = json!("codex_spark");
    assert_eq!(codex_rate_limit_windows(Some(&spark)), []);
    assert_eq!(codex_rate_limit_windows(None), []);
}

#[test]
fn merge_keeps_omitted_windows_and_known_resets() {
    let session = window("five_hour", "session", "Session", 20.0, Some(100), None);
    let weekly = window("seven_day", "weekly", "Weekly", 50.0, None, None);
    let merged = merge_usage_windows(
        &[weekly, session.clone()],
        &[UsageWindow {
            used_percent: 30.0,
            resets_at: None,
            ..session
        }],
    );
    let summary: Vec<(&str, f64, Option<i64>)> = merged
        .iter()
        .map(|w| (w.id.as_str(), w.used_percent, w.resets_at))
        .collect();
    assert_eq!(
        summary,
        [("five_hour", 30.0, Some(100)), ("seven_day", 50.0, None)]
    );
}

#[test]
fn extract_folds_a_stream_and_metadata_exposes_it() {
    let messages = vec![
        rate_limit_event(&json!({"rateLimitType": "five_hour", "utilization": 0.1})),
        rate_limit_event(&json!({"rateLimitType": "seven_day", "utilization": 0.6})),
        rate_limit_event(&json!({"rateLimitType": "five_hour", "utilization": 0.25})),
        json!({"type": "result", "subtype": "success", "result": "ok"}),
    ];
    let used: Vec<f64> = extract_usage_windows(&messages)
        .iter()
        .map(|w| w.used_percent)
        .collect();
    assert_eq!(used, [25.0, 60.0]);
    let metadata = build_normalized_result_metadata(BuildMetadataOptions {
        tool: "claude",
        exit_code: 0,
        parsed_output: Some(&messages),
        ..Default::default()
    });
    assert_eq!(metadata.usage_windows.len(), 2);
    let serialized = serde_json::to_value(&metadata).unwrap();
    assert_eq!(serialized["usageWindows"][0]["windowDurationMins"], 300);
    // Rollout token_count events carry the snapshot under payload.
    let rollout = [json!({
        "type": "event_msg",
        "payload": {"type": "token_count", "rate_limits": {"primary": {"used_percent": 5}}}
    })];
    assert_eq!(extract_usage_windows(&rollout)[0].used_percent, 5.0);
}

#[test]
fn apply_codex_rollout_usage_windows_reads_the_snapshot() {
    let codex_home = tempfile::tempdir().unwrap();
    let thread = "0199a213-81c0-7800-8aa1-bbab2a035a53";
    let dir = codex_home.path().join("sessions/2026/10/22");
    std::fs::create_dir_all(&dir).unwrap();
    let event = json!({
        "type": "event_msg",
        "payload": {"type": "token_count", "rate_limits": {
            "limit_id": "codex",
            "primary": {"used_percent": 7, "window_minutes": 300, "resets_at": 1}
        }}
    });
    std::fs::write(
        dir.join(format!("rollout-2026-10-22T10-00-00-{thread}.jsonl")),
        format!("{event}\n"),
    )
    .unwrap();
    let options = CodexRolloutOptions {
        codex_home: Some(codex_home.path().to_path_buf()),
        ..Default::default()
    };
    let mut metadata = ResultMetadata {
        tool: "codex".into(),
        session_id: Some(thread.into()),
        ..Default::default()
    };
    assert!(apply_codex_rollout_usage_windows(&mut metadata, &options));
    assert_eq!(metadata.usage_windows[0].id, "primary");
    assert_eq!(metadata.usage_windows[0].used_percent, 7.0);
    let mut other = ResultMetadata {
        tool: "claude".into(),
        session_id: Some(thread.into()),
        ..Default::default()
    };
    assert!(!apply_codex_rollout_usage_windows(&mut other, &options));
}
