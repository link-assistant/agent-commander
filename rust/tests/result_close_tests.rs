//! A process that outlives its result is closed and still judged by that
//! result (hive-mind#1280, #3015; issue #55). A fake `claude` on PATH prints a
//! stream-json turn and then keeps running.
#![cfg(unix)]

use agent_commander::{agent, Agent, AgentOptions, AgentStartOptions, AgentStopOptions};
use serde_json::json;
use std::path::PathBuf;
use std::time::{Duration, Instant};

static PATH_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

struct FakeClaude {
    previous_path: String,
    dir: PathBuf,
    _lock: tokio::sync::MutexGuard<'static, ()>,
}

impl Drop for FakeClaude {
    fn drop(&mut self) {
        std::env::set_var("PATH", &self.previous_path);
        let _ = std::fs::remove_dir_all(&self.dir);
    }
}

/// Put a fake `claude` that prints `events` and lingers first on PATH.
async fn fake_claude(events: &[&str]) -> FakeClaude {
    use std::os::unix::fs::PermissionsExt;
    let lock = PATH_LOCK.lock().await;
    let catalog = [
        (
            "init",
            json!({"type": "system", "subtype": "init", "model": "claude-opus-5-5"}),
        ),
        (
            "assistant",
            json!({"type": "assistant", "message": {"model": "claude-opus-5-5", "content": [{"type": "text", "text": "Done"}]}}),
        ),
        (
            "task",
            json!({"type": "system", "subtype": "task_started", "task_id": "t1", "task_type": "local_bash", "is_backgrounded": true}),
        ),
        (
            "result",
            json!({"type": "result", "subtype": "success", "is_error": false, "result": "Done", "session_id": "s-1"}),
        ),
    ];
    let mut script = String::from("#!/usr/bin/env bash\n");
    for name in events {
        let (_, event) = catalog.iter().find(|(key, _)| key == name).unwrap();
        script.push_str(&format!("echo '{event}'\n"));
    }
    script.push_str("sleep 30\n");
    let dir = std::env::temp_dir().join(format!(
        "agent-commander-fake-claude-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&dir).unwrap();
    let path = dir.join("claude");
    std::fs::write(&path, script).unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
    let previous_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{previous_path}", dir.display()));
    FakeClaude {
        previous_path,
        dir,
        _lock: lock,
    }
}

async fn start() -> Agent {
    let mut controller = agent(AgentOptions {
        tool: "claude".into(),
        working_directory: std::env::temp_dir().display().to_string(),
        prompt: Some("hi".into()),
        json: true,
        isolation: "none".into(),
        ..Default::default()
    })
    .unwrap();
    controller
        .start(AgentStartOptions {
            attached: false,
            ..Default::default()
        })
        .await
        .unwrap();
    controller
}

#[tokio::test]
async fn close_timeout_closes_a_lingering_process_after_a_successful_result() {
    let _fake = fake_claude(&["init", "assistant", "result"]).await;
    let mut controller = start().await;
    let started = Instant::now();
    let result = controller
        .stop(AgentStopOptions {
            close_timeout: Some(Duration::from_millis(200)),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(result.metadata.terminated_after_result);
    assert!(result.metadata.success, "{:?}", result.metadata);
    assert_eq!(result.metadata.signal.as_deref(), Some("SIGTERM"));
    assert_eq!(result.metadata.observed_models, ["claude-opus-5-5"]);
}

#[tokio::test]
async fn background_wait_reports_background_tasks_it_had_to_stop() {
    let _fake = fake_claude(&["init", "assistant", "task", "result"]).await;
    let mut controller = start().await;
    let result = controller
        .stop(AgentStopOptions {
            close_timeout: Some(Duration::from_millis(100)),
            background_wait: Some(Duration::from_millis(200)),
            ..Default::default()
        })
        .await
        .unwrap();
    assert!(result.metadata.terminated_after_result);
    assert!(!result.metadata.success);
    assert_eq!(
        result.metadata.error_type.as_deref(),
        Some("background_tasks_stopped")
    );
    assert_eq!(result.metadata.background_tasks_stopped, 1);
}

#[tokio::test]
async fn cancel_after_a_successful_result_keeps_the_success() {
    let _fake = fake_claude(&["init", "assistant", "result"]).await;
    let mut controller = start().await;
    tokio::time::sleep(Duration::from_millis(1000)).await;
    let result = controller.cancel().await.unwrap();
    assert!(result.metadata.terminated_after_result);
    assert!(result.metadata.success, "{:?}", result.metadata);
}

#[tokio::test]
async fn cancel_before_the_result_is_a_failure() {
    let _fake = fake_claude(&["init", "assistant"]).await;
    let mut controller = start().await;
    tokio::time::sleep(Duration::from_millis(300)).await;
    let result = controller.cancel().await.unwrap();
    assert!(!result.metadata.terminated_after_result);
    assert!(!result.metadata.success);
    assert_eq!(result.metadata.signal.as_deref(), Some("SIGTERM"));
    assert_eq!(result.metadata.error_type.as_deref(), Some("signal"));
}

#[test]
fn the_stdout_reader_waits_for_complete_lines() {
    let mut reader = agent_commander::StdoutMessageReader::new();
    assert_eq!(reader.read("{\"type\":\"result\",\"subt").len(), 0);
    let messages = reader.read("{\"type\":\"result\",\"subtype\":\"success\"}\n{\"type\"");
    assert_eq!(messages.len(), 1);
    assert!(agent_commander::has_final_result("claude", messages));
    assert_eq!(
        reader
            .read("{\"type\":\"result\",\"subtype\":\"success\"}\n{\"type\":\"x\"}\n")
            .len(),
        2
    );
}
