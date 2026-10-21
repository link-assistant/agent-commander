//! Process exit and termination behaviour ported from Hive Mind
//! (hive-mind#3015 process-group checks, codex.process-exit signal mapping;
//! issue #55).
#![cfg(unix)]

use agent_commander::executor::{
    execute_command, is_process_group_alive, signal_from_exit_code, signal_name, start_command,
};
use std::time::{Duration, Instant};

/// Live (non-zombie) members of a process group. A killed orphan stays a
/// zombie until its new parent reaps it, and some container inits never do.
fn live_group_members(pgid: u32) -> usize {
    let output = std::process::Command::new("ps")
        .args(["-A", "-o", "pgid=,stat="])
        .output()
        .expect("ps");
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .filter(|line| {
            let mut fields = line.split_whitespace();
            fields.next().and_then(|group| group.parse::<u32>().ok()) == Some(pgid)
                && !fields.next().unwrap_or("").starts_with('Z')
        })
        .count()
}

async fn group_gone(pgid: u32) -> bool {
    let deadline = Instant::now() + Duration::from_secs(2);
    while live_group_members(pgid) > 0 && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    live_group_members(pgid) == 0
}

#[test]
fn signal_numbers_and_exit_codes_name_signals() {
    assert_eq!(signal_name(9), Some("SIGKILL"));
    assert_eq!(signal_from_exit_code(130), Some("SIGINT"));
    assert_eq!(signal_from_exit_code(143), Some("SIGTERM"));
    assert_eq!(signal_from_exit_code(128), None);
    assert_eq!(signal_from_exit_code(2), None);
}

#[tokio::test]
async fn a_killed_shell_reports_exit_137_and_sigkill() {
    let result = execute_command("kill -9 $$", false, false).await.unwrap();
    assert_eq!(result.exit_code, 137);
    assert_eq!(result.signal.as_deref(), Some("SIGKILL"));
}

#[tokio::test]
async fn an_exit_code_of_143_names_sigterm() {
    let result = execute_command("exit 143", false, false).await.unwrap();
    assert_eq!(result.exit_code, 143);
    assert_eq!(result.signal.as_deref(), Some("SIGTERM"));
}

#[tokio::test]
async fn a_grandchild_holding_stdout_cannot_hang_wait_for_exit() {
    let started = Instant::now();
    let mut handle = start_command("(sleep 30 &); echo done", false)
        .await
        .unwrap()
        .with_pipe_drain(Some(Duration::from_millis(200)));
    let pid = handle.pid().unwrap();
    assert_eq!(handle.wait_for_exit().await.unwrap(), 0);
    assert!(handle.get_output().0.contains("done"));
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(group_gone(pid).await);
}

#[tokio::test]
async fn terminate_signals_the_group_after_the_wrapper_exited() {
    let mut handle = start_command("(sleep 30 &); exit 0", false)
        .await
        .unwrap()
        .with_pipe_drain(None);
    let pid = handle.pid().unwrap();
    tokio::time::sleep(Duration::from_millis(300)).await;
    assert!(is_process_group_alive(pid).await);
    assert!(handle.terminate_with("SIGTERM", None).await.unwrap());
    let started = Instant::now();
    handle.wait_for_exit().await.unwrap();
    assert!(started.elapsed() < Duration::from_secs(5));
    assert!(group_gone(pid).await);
}

#[tokio::test]
async fn terminate_escalates_to_sigkill_when_sigterm_is_ignored() {
    let mut handle = start_command("trap '' TERM; sleep 30 & wait", false)
        .await
        .unwrap();
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(handle
        .terminate_with("SIGTERM", Some(Duration::from_millis(300)))
        .await
        .unwrap());
    assert_eq!(handle.wait_for_exit().await.unwrap(), 137);
    assert_eq!(handle.signal(), Some("SIGKILL"));
}

#[tokio::test]
async fn peek_stdout_reads_output_while_running() {
    let mut handle = start_command("echo early; sleep 30", false).await.unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while !handle.peek_stdout().contains("early") && Instant::now() < deadline {
        tokio::time::sleep(Duration::from_millis(20)).await;
    }
    assert!(handle.peek_stdout().contains("early"));
    handle.terminate().await.unwrap();
    assert_eq!(handle.wait_for_exit().await.unwrap(), 143);
}
