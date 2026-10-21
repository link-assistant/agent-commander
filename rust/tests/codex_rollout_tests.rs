//! Codex rollouts: resume check (hive-mind#2888) and the usage-limit
//! cross-check of a failed exit (hive-mind#3570; issue #55).

use agent_commander::{
    apply_codex_rollout_usage_limit, can_resume_codex_session, classify_codex_rate_limit_snapshot,
    codex_rollout_limit_facts, detect_codex_rollout_usage_limit, find_codex_rollout_file,
    is_codex_rollout_file_name, read_codex_rollout_limit_facts, CodexRolloutOptions,
    ResultMetadata,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const THREAD: &str = "019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b";
const RESETS_AT: i64 = 1_798_761_600; // Jan 1, 2027, 12:00 AM UTC

fn line(payload: &Value) -> String {
    json!({"timestamp": "2026-10-21T00:00:00Z", "type": "event_msg", "payload": payload})
        .to_string()
}

fn token_count(used_percent: u32) -> String {
    line(&json!({
        "type": "token_count",
        "rate_limits": {
            "primary": {"used_percent": used_percent, "window_minutes": 300, "resets_at": RESETS_AT},
            "secondary": {"used_percent": 40, "window_minutes": 10080, "resets_at": RESETS_AT + 86400}
        }
    }))
}

fn task_started() -> String {
    line(&json!({"type": "task_started"}))
}

fn write_rollout(codex_home: &Path, lines: &[String]) -> PathBuf {
    let dir = codex_home
        .join("sessions")
        .join("2026")
        .join("10")
        .join("21");
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join(format!("rollout-2026-10-21T00-00-00-{THREAD}.jsonl"));
    std::fs::write(&file, format!("{}\n", lines.join("\n"))).unwrap();
    file
}

fn options(codex_home: &Path) -> CodexRolloutOptions {
    CodexRolloutOptions {
        codex_home: Some(codex_home.to_path_buf()),
        ..Default::default()
    }
}

#[test]
fn rollout_file_name_matches_the_thread_suffix_only() {
    assert!(is_codex_rollout_file_name(
        &format!("rollout-2026-10-21T00-00-00-{THREAD}.jsonl"),
        THREAD
    ));
    assert!(!is_codex_rollout_file_name(
        &format!("rollout-x-{THREAD}.json"),
        THREAD
    ));
    assert!(!is_codex_rollout_file_name(
        &format!("other-{THREAD}.jsonl"),
        THREAD
    ));
}

#[test]
fn can_resume_finds_a_rollout_and_rejects_a_missing_one() {
    let home = tempfile::tempdir().unwrap();
    let file = write_rollout(home.path(), &[task_started()]);
    assert_eq!(
        find_codex_rollout_file(&home.path().join("sessions"), THREAD),
        Some(file)
    );
    assert!(can_resume_codex_session(THREAD, &options(home.path())));
    assert!(!can_resume_codex_session(
        "missing-thread-0000",
        &options(home.path())
    ));
    // Ids that are not thread-shaped never reach the file system walk.
    assert!(!can_resume_codex_session("../x", &options(home.path())));
    assert!(!can_resume_codex_session("", &options(home.path())));
}

#[test]
fn rate_limit_snapshot_needs_100_percent_with_a_reset() {
    let reached = classify_codex_rate_limit_snapshot(Some(&json!({
        "primary": {"used_percent": 100, "window_minutes": 300, "resets_at": RESETS_AT},
        "rate_limit_reached_type": "primary"
    })));
    assert!(reached.reached);
    assert_eq!(reached.window.as_deref(), Some("5-hour"));
    assert_eq!(reached.resets_at, Some(RESETS_AT));
    assert_eq!(reached.reset_time.as_deref(), Some("Jan 1, 2027, 12:00 AM"));
    assert_eq!(reached.timezone.as_deref(), Some("UTC"));
    assert_eq!(reached.reason, "primary 5-hour window at 100% (primary)");

    let no_reset = classify_codex_rate_limit_snapshot(Some(&json!({
        "primary": {"used_percent": 100},
        "rate_limit_reached_type": "primary"
    })));
    assert!(!no_reset.reached);
    assert!(
        no_reset.reason.contains("peak used_percent 100"),
        "{}",
        no_reset.reason
    );
    assert!(!classify_codex_rate_limit_snapshot(None).reached);
    assert!(!classify_codex_rate_limit_snapshot(Some(&Value::Null)).reached);
}

#[test]
fn limit_facts_read_only_the_last_turn() {
    let text = [
        token_count(100),
        line(&json!({
            "type": "error",
            "message": "You've hit your usage limit",
            "codex_error_info": "usage_limit_exceeded"
        })),
        task_started(),
        token_count(55),
        "not json".to_string(),
    ]
    .join("\n");
    let facts = codex_rollout_limit_facts(&text);
    assert_eq!(
        facts.rate_limits.unwrap()["primary"]["used_percent"],
        json!(55)
    );
    assert_eq!(facts.error_text, None);
}

#[test]
fn limit_facts_read_a_bounded_tail() {
    let home = tempfile::tempdir().unwrap();
    write_rollout(
        home.path(),
        &[task_started(), "x".repeat(4096), token_count(100)],
    );
    let (path, facts) = read_codex_rollout_limit_facts(
        THREAD,
        &CodexRolloutOptions {
            max_bytes: Some(1024),
            ..options(home.path())
        },
    )
    .unwrap();
    assert!(path.ends_with(format!("rollout-2026-10-21T00-00-00-{THREAD}.jsonl")));
    assert_eq!(
        facts.rate_limits.unwrap()["primary"]["used_percent"],
        json!(100)
    );
    let missing = read_codex_rollout_limit_facts("missing-thread-0000", &options(home.path()));
    assert!(missing.unwrap_err().starts_with("no rollout under "));
}

#[test]
fn detect_uses_rate_limits_then_the_error_event() {
    let home = tempfile::tempdir().unwrap();
    write_rollout(home.path(), &[task_started(), token_count(100)]);
    let from_snapshot = detect_codex_rollout_usage_limit(THREAD, &options(home.path()));
    assert!(from_snapshot.reached);
    assert_eq!(from_snapshot.resets_at, Some(RESETS_AT));
    assert!(from_snapshot.rollout_path.is_some());

    write_rollout(
        home.path(),
        &[
            task_started(),
            line(&json!({
                "type": "error",
                "message": "stream error",
                "codex_error_info": {"usage_limit_exceeded": {}}
            })),
        ],
    );
    let from_error = detect_codex_rollout_usage_limit(THREAD, &options(home.path()));
    assert!(from_error.reached);
    assert_eq!(from_error.resets_at, None);
    assert_eq!(from_error.reason, "rollout error: stream error");

    write_rollout(home.path(), &[task_started(), token_count(20)]);
    assert!(!detect_codex_rollout_usage_limit(THREAD, &options(home.path())).reached);
}

#[test]
fn apply_only_fills_failed_unsignalled_codex_runs() {
    let home = tempfile::tempdir().unwrap();
    write_rollout(home.path(), &[task_started(), token_count(100)]);
    let base = ResultMetadata {
        tool: "codex".into(),
        exit_code: 1,
        session_id: Some(THREAD.into()),
        ..Default::default()
    };
    let mut filled = base.clone();
    assert!(apply_codex_rollout_usage_limit(
        &mut filled,
        &options(home.path())
    ));
    assert!(filled.limit_reached);
    assert!(!filled.success);
    assert_eq!(filled.limit_source.as_deref(), Some("codex-rollout"));
    assert_eq!(filled.limit_window.as_deref(), Some("5-hour"));
    assert_eq!(
        serde_json::to_value(&filled).unwrap()["limitSource"],
        json!("codex-rollout")
    );

    let skipped = [
        ResultMetadata {
            signal: Some("SIGTERM".into()),
            ..base.clone()
        },
        ResultMetadata {
            exit_code: 0,
            success: true,
            ..base.clone()
        },
        ResultMetadata {
            tool: "claude".into(),
            ..base.clone()
        },
        ResultMetadata {
            session_id: None,
            ..base.clone()
        },
    ];
    for mut metadata in skipped {
        assert!(!apply_codex_rollout_usage_limit(
            &mut metadata,
            &options(home.path())
        ));
        assert!(!metadata.limit_reached, "{metadata:?}");
        assert_eq!(metadata.limit_source, None);
        // An unset source is not serialized.
        assert!(serde_json::to_value(&metadata)
            .unwrap()
            .get("limitSource")
            .is_none());
    }
}

#[test]
fn run_env_codex_home_wins_and_an_unset_one_means_the_default() {
    let passed = CodexRolloutOptions::for_run_env(
        &[
            ("CODEX_HOME".into(), "/tmp/first".into()),
            ("CODEX_HOME".into(), "/tmp/codex home".into()),
        ],
        &[],
    );
    assert_eq!(passed.codex_home, Some(PathBuf::from("/tmp/codex home")));
    let unset = CodexRolloutOptions::for_run_env(&[], &["CODEX_HOME".into()]);
    assert!(unset.codex_home.unwrap().ends_with(".codex"));
    assert_eq!(CodexRolloutOptions::for_run_env(&[], &[]).codex_home, None);
}

#[cfg(unix)]
#[tokio::test]
async fn stop_reports_a_usage_limit_found_only_in_the_codex_rollout() {
    use agent_commander::{agent, AgentOptions, AgentStartOptions, AgentStopOptions};
    use std::os::unix::fs::PermissionsExt;

    let home = tempfile::tempdir().unwrap();
    write_rollout(home.path(), &[task_started(), token_count(100)]);
    let bin = tempfile::tempdir().unwrap();
    let script = bin.path().join("codex");
    let started = json!({"type": "thread.started", "thread_id": THREAD});
    std::fs::write(
        &script,
        format!("#!/usr/bin/env bash\necho '{started}'\necho 'Codex command failed' >&2\nexit 1\n"),
    )
    .unwrap();
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();
    let previous_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{previous_path}", bin.path().display()));

    let mut controller = agent(AgentOptions {
        tool: "codex".into(),
        working_directory: std::env::temp_dir().display().to_string(),
        prompt: Some("hi".into()),
        json: true,
        isolation: "none".into(),
        extra_env: vec![("CODEX_HOME".into(), home.path().display().to_string())],
        ..Default::default()
    })
    .unwrap();
    let outcome = async {
        controller
            .start(AgentStartOptions {
                attached: false,
                ..Default::default()
            })
            .await?;
        controller.stop(AgentStopOptions::default()).await
    }
    .await;
    std::env::set_var("PATH", previous_path);

    let metadata = outcome.unwrap().metadata;
    assert_eq!(metadata.session_id.as_deref(), Some(THREAD));
    assert!(!metadata.success);
    assert!(metadata.limit_reached, "{metadata:?}");
    assert_eq!(metadata.limit_source.as_deref(), Some("codex-rollout"));
    assert_eq!(metadata.limit_resets_at, Some(RESETS_AT));
}
