//! Print-mode turns, background tasks, signals and observed models ported
//! from Hive Mind (hive-mind#2301, #2840, #3015; issue #55).

use agent_commander::{
    assess_background_tasks, build_normalized_result_metadata, extract_observed_models,
    print_wait_ceiling_seconds, track_background_tasks, BackgroundTask, BuildMetadataOptions,
    ResultMetadata, StoppedBackgroundTask,
};
use serde_json::{json, Value};

fn init() -> Value {
    json!({"type": "system", "subtype": "init", "model": "claude-opus-5-5"})
}

fn assistant(text: &str) -> Value {
    json!({
        "type": "assistant",
        "message": {"model": "claude-opus-5-5", "content": [{"type": "text", "text": text}]}
    })
}

fn success() -> Value {
    json!({
        "type": "result",
        "subtype": "success",
        "is_error": false,
        "result": "Done",
        "session_id": "s-1"
    })
}

fn task_started(id: &str) -> Value {
    json!({
        "type": "system",
        "subtype": "task_started",
        "task_id": id,
        "task_type": "local_bash",
        "description": "npm test",
        "is_backgrounded": true
    })
}

fn stream(messages: &[Value]) -> String {
    messages
        .iter()
        .map(Value::to_string)
        .collect::<Vec<_>>()
        .join("\n")
}

fn metadata(
    tool: &str,
    exit_code: i32,
    plain_output: &str,
    terminated_after_result: bool,
) -> ResultMetadata {
    build_normalized_result_metadata(BuildMetadataOptions {
        tool,
        exit_code,
        plain_output,
        terminated_after_result,
        ..Default::default()
    })
}

#[test]
fn a_started_task_runs_until_it_reports_an_end() {
    let started =
        track_background_tasks(&[init(), assistant("Working"), task_started("t1"), success()]);
    assert_eq!(
        started.running,
        vec![BackgroundTask {
            id: "t1".into(),
            task_type: Some("local_bash".into()),
            description: Some("npm test".into()),
        }]
    );
    assert!(!started.turn_open);

    let finished = track_background_tasks(&[
        task_started("t1"),
        json!({"type": "system", "subtype": "task_updated", "task_id": "t1", "patch": {"status": "completed"}}),
        success(),
    ]);
    assert_eq!(finished.running, []);
}

#[test]
fn background_tasks_changed_is_authoritative() {
    let state = track_background_tasks(&[
        task_started("t1"),
        json!({"type": "system", "subtype": "background_tasks_changed", "tasks": [{"task_id": "t2", "task_type": "local_agent"}]}),
    ]);
    let ids: Vec<_> = state.running.iter().map(|task| task.id.as_str()).collect();
    assert_eq!(ids, ["t2"]);
}

#[test]
fn the_print_wait_ceiling_makes_a_success_incomplete() {
    let messages = [init(), assistant("Working"), task_started("t1"), success()];
    let output = "Background tasks still running after 600s; terminating";
    assert_eq!(print_wait_ceiling_seconds(output), Some(600));
    let verdict = assess_background_tasks(&messages, output, false);
    assert!(verdict.incomplete);
    assert_eq!(verdict.background_tasks_stopped, 1);
    assert!(verdict
        .cause
        .unwrap()
        .contains("600s print-mode wait ceiling"));
}

#[test]
fn a_stop_the_model_asked_for_is_followed_by_a_reply() {
    let stopped = json!({
        "type": "system",
        "subtype": "task_notification",
        "task_id": "t1",
        "status": "stopped",
        "summary": "npm test"
    });
    let idle = assess_background_tasks(
        &[
            assistant("Working"),
            task_started("t1"),
            success(),
            stopped.clone(),
        ],
        "",
        false,
    );
    assert!(idle.incomplete);
    assert_eq!(
        idle.stopped_background_tasks,
        vec![StoppedBackgroundTask {
            id: "t1".into(),
            summary: Some("npm test".into()),
            output_file: None,
        }]
    );

    let asked = assess_background_tasks(
        &[
            task_started("t1"),
            stopped,
            assistant("Stopped the tests"),
            success(),
        ],
        "",
        false,
    );
    assert!(!asked.incomplete);
}

#[test]
fn subagent_stats_killed_system_counts_stopped_tasks() {
    let mut result = success();
    result["subagent_stats"] = json!({"killed": {"system": 2}});
    let verdict = assess_background_tasks(&[result], "", false);
    assert_eq!(verdict.background_tasks_stopped, 2);
    assert!(verdict.incomplete);
}

#[test]
fn stopped_background_tasks_fail_a_successful_result() {
    let output = format!(
        "{}\nBackground tasks still running after 600s; terminating\n",
        stream(&[init(), assistant("Working"), task_started("t1"), success()])
    );
    let result = metadata("claude", 0, &output, false);
    assert!(!result.success);
    assert_eq!(
        result.error_type.as_deref(),
        Some("background_tasks_stopped")
    );
    assert_eq!(result.print_wait_ceiling_seconds, Some(600));
    assert_eq!(result.background_tasks_stopped, 1);
    assert_eq!(result.running_background_tasks.len(), 1);
}

#[test]
fn a_caller_stop_after_a_successful_result_is_not_a_failure() {
    let result = metadata(
        "claude",
        143,
        &stream(&[init(), assistant("Done"), success()]),
        true,
    );
    assert!(result.success);
    assert_eq!(result.exit_code, 143);
    assert_eq!(result.signal.as_deref(), Some("SIGTERM"));
    assert!(result.terminated_after_result);
    assert!(!result.error_during_execution);

    let running = metadata(
        "claude",
        143,
        &stream(&[init(), assistant("Done"), task_started("t1"), success()]),
        true,
    );
    assert!(!running.success);
    assert_eq!(
        running.error_type.as_deref(),
        Some("background_tasks_stopped")
    );
    assert!(running
        .error_message
        .unwrap()
        .contains("stopped after its result"));
}

#[test]
fn a_stop_before_the_result_is_still_a_failure() {
    let result = metadata(
        "claude",
        143,
        &stream(&[init(), assistant("Working")]),
        true,
    );
    assert!(!result.success);
}

#[test]
fn a_signal_exit_names_the_signal_not_the_last_output_line() {
    let result = metadata(
        "codex",
        137,
        "{\"type\":\"thread.started\",\"thread_id\":\"t\"}\n{\"type\":\"turn.started\"}\n\
         2026-05-01T10:00:00.123Z DEBUG codex_core::exec: running npm test\n",
        false,
    );
    assert_eq!(result.signal.as_deref(), Some("SIGKILL"));
    assert!(!result.success);
    assert_eq!(result.error_type.as_deref(), Some("signal"));
    assert_eq!(
        result.error_message.as_deref(),
        Some("Process exited with code 137 (SIGKILL)")
    );
}

#[test]
fn tracing_telemetry_is_never_the_exit_reason() {
    let result = metadata(
        "codex",
        1,
        "error: unexpected argument --foo\n\
         2026-05-01T10:00:00.123Z INFO codex_core::session: shutting down\n",
        false,
    );
    assert_eq!(result.signal, None);
    assert_eq!(result.error_type.as_deref(), Some("exit_code"));
    assert_eq!(
        result.error_message.as_deref(),
        Some("error: unexpected argument --foo")
    );
}

#[test]
fn an_explicit_signal_overrides_the_exit_code_inference() {
    let result = build_normalized_result_metadata(BuildMetadataOptions {
        tool: "codex",
        exit_code: 130,
        plain_output: "fatal: interrupted\n",
        signal: Some("SIGINT".into()),
        ..Default::default()
    });
    assert_eq!(
        result.error_message.as_deref(),
        Some("Process exited with code 130 (SIGINT): fatal: interrupted")
    );
}

#[test]
fn observed_models_list_the_main_thread_first_and_skip_synthetic_ids() {
    let messages = vec![
        init(),
        assistant("Hi"),
        json!({"type": "assistant", "parent_tool_use_id": "toolu_1", "message": {"model": "claude-haiku-5-5", "content": []}}),
        json!({"type": "assistant", "is_api_error_message": true, "message": {"model": "<synthetic>", "content": []}}),
    ];
    let (observed, last) = extract_observed_models(&messages);
    assert_eq!(observed, ["claude-opus-5-5", "claude-haiku-5-5"]);
    assert_eq!(last.as_deref(), Some("claude-opus-5-5"));

    let mut with_usage = messages;
    with_usage.push(json!({"type": "assistant", "message": {"model": "<synthetic>", "usage": {"input_tokens": 0}, "content": []}}));
    let result = metadata("claude", 0, &stream(&with_usage), false);
    assert_eq!(
        result.observed_models,
        ["claude-opus-5-5", "claude-haiku-5-5"]
    );
    assert!(result
        .result_model_usage
        .is_none_or(|usage| usage.get("<synthetic>").is_none()));
}

#[test]
fn claude_api_error_details_pass_through() {
    let overloaded = metadata(
        "claude",
        1,
        &stream(&[
            init(),
            json!({
                "type": "result",
                "subtype": "error_during_execution",
                "is_error": true,
                "error": "overloaded_error",
                "api_error_status": 529,
                "terminal_reason": "api_error",
                "request_id": "req_1"
            }),
        ]),
        false,
    );
    assert_eq!(overloaded.api_error.as_deref(), Some("overloaded_error"));
    assert_eq!(overloaded.api_error_status, Some(529));
    assert_eq!(overloaded.terminal_reason.as_deref(), Some("api_error"));
    assert_eq!(overloaded.request_id.as_deref(), Some("req_1"));

    let forbidden = metadata(
        "claude",
        1,
        &stream(&[
            init(),
            json!({
                "type": "result",
                "subtype": "success",
                "is_error": true,
                "error": "oauth_org_not_allowed",
                "api_error_status": 403,
                "result": "Your organization does not allow OAuth"
            }),
        ]),
        false,
    );
    assert_eq!(
        forbidden.error_type.as_deref(),
        Some("oauth_org_not_allowed")
    );
    assert_eq!(forbidden.api_error_status, Some(403));

    let clean = metadata(
        "claude",
        0,
        &stream(&[init(), assistant("Done"), success()]),
        false,
    );
    assert_eq!(clean.api_error, None);
    assert_eq!(clean.api_error_status, None);
}

#[test]
fn new_fields_serialize_in_camel_case() {
    let result = metadata(
        "claude",
        143,
        &stream(&[init(), assistant("Done"), success()]),
        true,
    );
    let value = serde_json::to_value(result).unwrap();
    for key in [
        "signal",
        "terminatedAfterResult",
        "observedModels",
        "observedModel",
        "apiError",
        "apiErrorStatus",
        "terminalReason",
        "requestId",
        "runningBackgroundTasks",
        "backgroundTasksStopped",
        "stoppedBackgroundTasks",
        "printWaitCeilingSeconds",
    ] {
        assert!(value.get(key).is_some(), "missing {key}");
    }
}
