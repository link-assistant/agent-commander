//! Close a process that lingers after its final result (hive-mind#1280, #3015).
//!
//! Claude Code can keep running after it wrote its `result` event: an MCP
//! server or a background task holds it open. Hive Mind waits a bounded time
//! (`HIVE_MIND_RESULT_STREAM_CLOSE_MS`) and then stops the process itself. The
//! stop is the caller's own signal, so the run is still judged by its result.

use crate::background_tasks::track_background_tasks;
use crate::completion::completion_state;
use crate::executor::ProcessHandle;
use crate::streaming::{JsonRecordEvent, JsonRecordScanner};
use serde_json::Value;
use std::io;
use std::time::{Duration, Instant};

/// Default interval between checks of a running process.
pub const DEFAULT_RESULT_POLL: Duration = Duration::from_millis(100);

/// Read stream events incrementally from a growing stdout buffer.
#[derive(Debug, Clone, Default)]
pub struct StdoutMessageReader {
    scanner: JsonRecordScanner,
    messages: Vec<Value>,
    scanned: usize,
}

impl StdoutMessageReader {
    pub fn new() -> Self {
        Self::default()
    }

    /// Scan the complete lines added since the last call and return every
    /// event parsed so far. A trailing partial line (or UTF-8 sequence) waits
    /// for the next call.
    pub fn read(&mut self, stdout: &str) -> &[Value] {
        let end = stdout.rfind('\n').map_or(0, |index| index + 1);
        if end > self.scanned {
            for event in self.scanner.write(&stdout[self.scanned..end]) {
                if let JsonRecordEvent::Json { value, .. } = event {
                    match value {
                        Value::Array(values) => self.messages.extend(values),
                        value => self.messages.push(value),
                    }
                }
            }
            self.scanned = end;
        }
        &self.messages
    }
}

/// Whether the main thread has ended its turn with a final result.
pub fn has_final_result(tool: &str, messages: &[Value]) -> bool {
    matches!(
        completion_state(tool, messages),
        Some("completed" | "failed")
    )
}

/// How long a process may stay after its final result.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ResultCloseOptions {
    /// Time the process may stay after its result once no background task
    /// runs; `None` waits for it to exit
    pub close_timeout: Option<Duration>,
    /// Extra time granted while background tasks still run; `None` leaves
    /// them to the tool's own ceiling
    pub background_wait: Option<Duration>,
    /// Poll interval
    pub poll: Duration,
}

impl Default for ResultCloseOptions {
    fn default() -> Self {
        Self {
            close_timeout: None,
            background_wait: None,
            poll: DEFAULT_RESULT_POLL,
        }
    }
}

/// Wait for a process to exit, stopping it when it outlives its result.
///
/// Returns the exit code and whether the process was stopped after its result.
pub async fn wait_for_exit_after_result(
    handle: &mut ProcessHandle,
    tool: &str,
    options: ResultCloseOptions,
) -> io::Result<(i32, bool)> {
    let Some(close_timeout) = options.close_timeout else {
        return Ok((handle.wait_for_exit().await?, false));
    };
    let mut reader = StdoutMessageReader::new();
    let mut result_at: Option<Instant> = None;
    let mut idle_at: Option<Instant> = None;
    while !handle.try_wait()? {
        tokio::time::sleep(options.poll).await;
        if handle.try_wait()? {
            break;
        }
        let messages = reader.read(&handle.peek_stdout());
        if !has_final_result(tool, messages) {
            result_at = None;
            idle_at = None;
            continue;
        }
        let now = Instant::now();
        let first_result = *result_at.get_or_insert(now);
        let running = !track_background_tasks(messages).running.is_empty();
        idle_at = if running {
            None
        } else {
            Some(idle_at.unwrap_or(now))
        };
        let idle_expired = idle_at.is_some_and(|at| now - at >= close_timeout);
        let background_expired = options
            .background_wait
            .is_some_and(|wait| now - first_result >= wait + close_timeout);
        if idle_expired || background_expired {
            handle.terminate().await?;
            return Ok((handle.wait_for_exit().await?, true));
        }
    }
    Ok((handle.wait_for_exit().await?, false))
}
