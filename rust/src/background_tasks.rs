//! Claude Code background tasks and print-mode turns (hive-mind#2301, #3015).
//!
//! After the main thread goes idle, `claude -p` waits for background tasks
//! (Agent, or Bash with `run_in_background`) up to
//! `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, then writes
//! "Background tasks still running after 600s; terminating" to stderr and
//! stops every task. The `result` event still says `success`, but the work is
//! unfinished, so the run is incomplete and should be resumed.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::LazyLock;

/// Claude's announcement that it stopped background tasks at its ceiling.
pub static PRINT_BG_CEILING_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"Background tasks still running after (\d+)s; terminating").expect("valid pattern")
});

const TERMINAL_TASK_STATUSES: &[&str] = &[
    "completed",
    "failed",
    "killed",
    "stopped",
    "cancelled",
    "error",
];

/// A background task that has not reported an end.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct BackgroundTask {
    pub id: String,
    #[serde(rename = "type")]
    pub task_type: Option<String>,
    pub description: Option<String>,
}

/// A background task stopped while the main thread was idle.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StoppedBackgroundTask {
    pub id: String,
    pub summary: Option<String>,
    pub output_file: Option<String>,
}

/// Background tasks and print-mode turn state over a message list.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BackgroundTaskState {
    /// Tasks that never reported an end
    pub running: Vec<BackgroundTask>,
    /// Tasks stopped while the main thread was idle; a stop the model asked
    /// for itself is followed by a main-thread reply, which clears the list
    pub stopped_tasks: Vec<StoppedBackgroundTask>,
    /// Last main-thread `result` event
    pub result_event: Option<Value>,
    pub result_count: usize,
    /// Whether the main thread is inside a turn (no result since its last reply)
    pub turn_open: bool,
}

/// Whether a print-mode turn ended with background work unfinished.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct BackgroundTaskAssessment {
    pub running_background_tasks: Vec<BackgroundTask>,
    pub background_tasks_stopped: u64,
    pub stopped_background_tasks: Vec<StoppedBackgroundTask>,
    pub print_wait_ceiling_seconds: Option<u64>,
    pub incomplete: bool,
    pub cause: Option<String>,
}

fn is_main_thread(event: &Value) -> bool {
    event
        .get("parent_tool_use_id")
        .and_then(Value::as_str)
        .is_none_or(str::is_empty)
}

fn text(value: &Value, key: &str) -> Option<String> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
        .map(String::from)
}

#[derive(Default)]
struct Tracker {
    tasks: Vec<BackgroundTask>,
    descriptions: Vec<(String, String)>,
    stopped: Vec<StoppedBackgroundTask>,
}

impl Tracker {
    fn description(&self, id: &str) -> Option<String> {
        self.descriptions
            .iter()
            .find(|(task, _)| task == id)
            .map(|(_, description)| description.clone())
    }

    fn add(&mut self, id: &str, task_type: Option<String>, description: Option<String>) {
        let known = self.description(id);
        if let Some(task) = self.tasks.iter_mut().find(|task| task.id == id) {
            task.task_type = task_type.or_else(|| task.task_type.take());
            task.description = description.or_else(|| task.description.take()).or(known);
        } else {
            self.tasks.push(BackgroundTask {
                id: id.to_string(),
                task_type,
                description: description.or(known),
            });
        }
    }

    fn remove(&mut self, id: &str) {
        self.tasks.retain(|task| task.id != id);
    }

    fn apply(&mut self, event: &Value) {
        let id = text(event, "task_id");
        match event.get("subtype").and_then(Value::as_str) {
            Some("task_started") => {
                if let Some(id) = id {
                    if let Some(description) = text(event, "description") {
                        self.descriptions.push((id.clone(), description));
                    }
                    if event["is_backgrounded"] == true {
                        self.add(&id, text(event, "task_type"), text(event, "description"));
                    }
                }
            }
            Some("background_tasks_changed") => {
                if let Some(tasks) = event.get("tasks").and_then(Value::as_array) {
                    self.tasks.clear();
                    for task in tasks {
                        if let Some(task_id) = text(task, "task_id") {
                            self.add(&task_id, text(task, "task_type"), text(task, "description"));
                        }
                    }
                }
            }
            Some("task_updated") => {
                if let Some(id) = id {
                    let patch = &event["patch"];
                    let status = patch.get("status").and_then(Value::as_str);
                    if status.is_some_and(|status| TERMINAL_TASK_STATUSES.contains(&status)) {
                        self.remove(&id);
                    } else if patch["is_backgrounded"] == true {
                        self.add(&id, None, None);
                    }
                }
            }
            Some("task_notification") => {
                if let Some(id) = &id {
                    self.remove(id);
                }
                if event["status"] == "stopped" {
                    let stopped_id = id
                        .or_else(|| text(event, "tool_use_id"))
                        .unwrap_or_else(|| format!("stopped-{}", self.stopped.len() + 1));
                    let entry = StoppedBackgroundTask {
                        id: stopped_id.clone(),
                        summary: text(event, "summary"),
                        output_file: text(event, "output_file"),
                    };
                    if let Some(existing) =
                        self.stopped.iter_mut().find(|task| task.id == stopped_id)
                    {
                        *existing = entry;
                    } else {
                        self.stopped.push(entry);
                    }
                }
            }
            _ => {}
        }
    }
}

/// Follow background tasks and the print-mode turn over a message list.
///
/// `background_tasks_changed` carries the authoritative list; `task_started`,
/// `task_updated` and `task_notification` keep it right for CLI versions that
/// do not send it.
pub fn track_background_tasks(messages: &[Value]) -> BackgroundTaskState {
    let mut tracker = Tracker::default();
    let mut result_event = None;
    let mut result_count = 0;
    let mut turn_open = true;
    for event in messages {
        match event.get("type").and_then(Value::as_str) {
            Some("assistant") if is_main_thread(event) => {
                turn_open = true;
                tracker.stopped.clear();
            }
            Some("result") if is_main_thread(event) => {
                result_event = Some(event.clone());
                result_count += 1;
                turn_open = false;
            }
            Some("system") => tracker.apply(event),
            _ => {}
        }
    }
    BackgroundTaskState {
        running: tracker.tasks,
        stopped_tasks: tracker.stopped,
        result_event,
        result_count,
        turn_open,
    }
}

/// Read the print-mode wait ceiling (seconds) from Claude's stderr announcement.
pub fn print_wait_ceiling_seconds(text: &str) -> Option<u64> {
    PRINT_BG_CEILING_PATTERN
        .captures(text)
        .and_then(|captures| captures[1].parse().ok())
}

/// Decide whether a print-mode turn ended with background work unfinished.
///
/// `terminated_after_result` says the caller stopped the process after its
/// result, while tasks may still have been running.
pub fn assess_background_tasks(
    messages: &[Value],
    output: &str,
    terminated_after_result: bool,
) -> BackgroundTaskAssessment {
    let state = track_background_tasks(messages);
    let ceiling = print_wait_ceiling_seconds(output);
    let system_killed = state
        .result_event
        .as_ref()
        .and_then(|result| result.pointer("/subagent_stats/killed/system"))
        .and_then(Value::as_u64)
        .unwrap_or(0);
    let cancelled_by_caller = if terminated_after_result {
        state.running.len() as u64
    } else {
        0
    };
    let background_tasks_stopped = system_killed
        .max(state.stopped_tasks.len() as u64)
        .max(cancelled_by_caller)
        .max(u64::from(ceiling.is_some()));
    let incomplete = !state.turn_open
        && state
            .result_event
            .as_ref()
            .is_some_and(|result| result["subtype"] == "success" && result["is_error"] != true)
        && background_tasks_stopped > 0;
    let cause = incomplete.then(|| match ceiling {
        Some(seconds) => format!(
            "Claude Code stopped background tasks after its {seconds}s print-mode wait ceiling (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS)"
        ),
        None if cancelled_by_caller > 0 => {
            "The process was stopped after its result while background tasks were still running"
                .to_string()
        }
        None => "Claude Code stopped background tasks when print mode exited".to_string(),
    });
    BackgroundTaskAssessment {
        running_background_tasks: state.running,
        background_tasks_stopped,
        stopped_background_tasks: state.stopped_tasks,
        print_wait_ceiling_seconds: ceiling,
        incomplete,
        cause,
    }
}

/// Whether a model id names a real model; `<synthetic>` does not.
pub fn is_real_model_id(model_id: &str) -> bool {
    let id = model_id.trim();
    !id.is_empty() && !(id.starts_with('<') && id.ends_with('>'))
}

/// Model ids a tool reports about itself (hive-mind#2840).
///
/// Returns main-thread models first, in order of first observation, then
/// models only seen from subagents, and the main-thread model observed last.
/// The ids come from `system/init` and assistant `message.model`, so they
/// survive a crash or a kill before the `result` event.
pub fn extract_observed_models(messages: &[Value]) -> (Vec<String>, Option<String>) {
    let mut main = Vec::new();
    let mut subagent = Vec::new();
    let mut observed_model = None;
    for event in messages {
        let id = match (
            event.get("type").and_then(Value::as_str),
            event.get("subtype").and_then(Value::as_str),
        ) {
            (Some("system"), Some("init")) => event.get("model"),
            (Some("assistant"), _) => event.pointer("/message/model"),
            _ => None,
        }
        .and_then(Value::as_str)
        .filter(|id| is_real_model_id(id))
        .map(|id| id.trim().to_string());
        let Some(id) = id else {
            continue;
        };
        if is_main_thread(event) {
            observed_model = Some(id.clone());
            main.push(id);
        } else {
            subagent.push(id);
        }
    }
    let mut observed = Vec::new();
    for id in main.into_iter().chain(subagent) {
        if !observed.contains(&id) {
            observed.push(id);
        }
    }
    (observed, observed_model)
}
