//! Codex rollouts (hive-mind#2888, #3570).
//!
//! Codex writes each thread to
//! `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl`.
//! `codex exec resume <id>` reads only that directory, so a run in a fresh
//! container or `CODEX_HOME` cannot resume a thread whose rollout is missing.
//!
//! `codex exec --json` does not always report a usage limit on stdout or
//! stderr. The rollout keeps two more sources: `event_msg` `token_count` with
//! `rate_limits.{primary,secondary}` (`used_percent`, `window_minutes`,
//! `resets_at` epoch seconds), and `event_msg` `error` with
//! `codex_error_info` `usage_limit_exceeded` (older Codex versions). Only the
//! last turn is read, so a limit an earlier turn waited out is not reported.

use regex::Regex;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::LazyLock;

use crate::file_tail::{default_home_dir, read_file_tail};
use crate::result_metadata::ResultMetadata;
use crate::usage_limit::{format_epoch_reset_time_utc, is_usage_limit_text};
use crate::usage_windows::codex_rate_limit_windows;

/// Directory under `CODEX_HOME` that holds the rollouts
pub const CODEX_SESSIONS_DIRNAME: &str = "sessions";

/// Bytes read from the end of a rollout
pub const ROLLOUT_TAIL_BYTES: u64 = 1024 * 1024;

/// `limit_source` of a limit found in a rollout
pub const CODEX_ROLLOUT_LIMIT_SOURCE: &str = "codex-rollout";

// `YYYY/MM/DD` plus slack; the walk never goes deeper.
const MAX_ROLLOUT_SEARCH_DEPTH: usize = 5;
const TURN_START_TYPES: [&str; 2] = ["task_started", "turn_started"];

// Only ids of this shape are matched against file names.
static THREAD_ID_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$").expect("valid thread id regex")
});

/// Where to look for Codex rollouts
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodexRolloutOptions {
    /// `CODEX_HOME`; defaults to the `CODEX_HOME` environment variable, then
    /// `~/.codex`
    pub codex_home: Option<PathBuf>,
    /// Home directory; defaults to `HOME` (`USERPROFILE` on Windows)
    pub home_dir: Option<PathBuf>,
    /// Bytes read from the end of a rollout; defaults to [`ROLLOUT_TAIL_BYTES`]
    pub max_bytes: Option<u64>,
}

impl CodexRolloutOptions {
    /// Options for a run launched with `extra_env` and `unset_env`.
    ///
    /// A `CODEX_HOME` passed to the run wins; an unset one means `~/.codex`.
    pub fn for_run_env(extra_env: &[(String, String)], unset_env: &[String]) -> Self {
        let passed = extra_env
            .iter()
            .rev()
            .find(|(name, value)| name == "CODEX_HOME" && !value.is_empty())
            .map(|(_, value)| PathBuf::from(value));
        let codex_home = passed.or_else(|| {
            unset_env
                .iter()
                .any(|name| name == "CODEX_HOME")
                .then(|| default_home_dir().join(".codex"))
        });
        Self {
            codex_home,
            ..Self::default()
        }
    }

    fn max_bytes(&self) -> u64 {
        self.max_bytes.unwrap_or(ROLLOUT_TAIL_BYTES)
    }
}

/// Codex `sessions` directory
pub fn codex_sessions_dir(options: &CodexRolloutOptions) -> PathBuf {
    let codex_home = options
        .codex_home
        .clone()
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| {
            std::env::var_os("CODEX_HOME")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        })
        .unwrap_or_else(|| {
            options
                .home_dir
                .clone()
                .unwrap_or_else(default_home_dir)
                .join(".codex")
        });
    codex_home.join(CODEX_SESSIONS_DIRNAME)
}

/// Whether `name` is the rollout file of `thread_id`
pub fn is_codex_rollout_file_name(name: &str, thread_id: &str) -> bool {
    name.starts_with("rollout-") && name.ends_with(&format!("-{thread_id}.jsonl"))
}

/// Find a thread's rollout; the newest date directories are searched first
pub fn find_codex_rollout_file(sessions_dir: &Path, thread_id: &str) -> Option<PathBuf> {
    if !THREAD_ID_PATTERN.is_match(thread_id) {
        return None;
    }
    walk(sessions_dir, thread_id, 0)
}

fn walk(dir: &Path, thread_id: &str, depth: usize) -> Option<PathBuf> {
    let mut entries: Vec<(String, fs::FileType)> = fs::read_dir(dir)
        .ok()?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let file_type = entry.file_type().ok()?;
            Some((entry.file_name().to_string_lossy().into_owned(), file_type))
        })
        .collect();
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    if let Some((name, _)) = entries.iter().find(|(name, file_type)| {
        file_type.is_file() && is_codex_rollout_file_name(name, thread_id)
    }) {
        return Some(dir.join(name));
    }
    if depth >= MAX_ROLLOUT_SEARCH_DEPTH {
        return None;
    }
    entries
        .iter()
        .filter(|(_, file_type)| file_type.is_dir())
        .find_map(|(name, _)| walk(&dir.join(name), thread_id, depth + 1))
}

/// Whether `codex exec resume <thread_id>` can find the thread.
///
/// A run in a new container or `CODEX_HOME` should start a new session
/// instead (hive-mind#2888).
pub fn can_resume_codex_session(thread_id: &str, options: &CodexRolloutOptions) -> bool {
    find_codex_rollout_file(&codex_sessions_dir(options), thread_id).is_some()
}

/// Usage-limit verdict from a rollout
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodexLimitVerdict {
    pub reached: bool,
    pub reason: String,
    /// Reset time formatted as `MMM D, YYYY, h:mm A`
    pub reset_time: Option<String>,
    /// Always `UTC` when `reset_time` is set
    pub timezone: Option<String>,
    /// Reset epoch (seconds)
    pub resets_at: Option<i64>,
    /// `5-hour`, `weekly`, `N-minute` or `usage`
    pub window: Option<String>,
    pub rollout_path: Option<PathBuf>,
}

fn number(value: Option<&Value>) -> Option<f64> {
    match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse().ok(),
        _ => None,
    }
    .filter(|number: &f64| number.is_finite())
}

fn format_number(value: f64) -> String {
    if value.fract() == 0.0 && value.abs() < 1e15 {
        format!("{value:.0}")
    } else {
        value.to_string()
    }
}

fn describe_window(minutes: Option<f64>) -> String {
    let Some(minutes) = minutes.filter(|minutes| *minutes > 0.0) else {
        return "usage".to_string();
    };
    match format_number(minutes).as_str() {
        "300" => "5-hour".to_string(),
        "10080" => "weekly".to_string(),
        label => format!("{label}-minute"),
    }
}

struct RateWindow<'a> {
    name: &'a str,
    used_percent: f64,
    resets_at: Option<f64>,
    window_minutes: Option<f64>,
}

/// Classify a rollout `token_count.rate_limits` snapshot.
///
/// A window is reached at `used_percent >= 100` with a `resets_at`;
/// `rate_limit_reached_type` alone (no reset) stays unclassified.
pub fn classify_codex_rate_limit_snapshot(snapshot: Option<&Value>) -> CodexLimitVerdict {
    let Some(snapshot) = snapshot.filter(|value| value.is_object()) else {
        return CodexLimitVerdict {
            reason: "no rate_limits snapshot".to_string(),
            ..CodexLimitVerdict::default()
        };
    };
    let windows: Vec<RateWindow<'_>> = ["primary", "secondary"]
        .into_iter()
        .filter_map(|name| {
            let window = snapshot.get(name)?;
            Some(RateWindow {
                name,
                used_percent: number(window.get("used_percent"))?,
                resets_at: number(window.get("resets_at")),
                window_minutes: number(window.get("window_minutes")),
            })
        })
        .collect();
    let type_note = snapshot
        .get("rate_limit_reached_type")
        .and_then(Value::as_str)
        .filter(|kind| !kind.is_empty())
        .map(|kind| format!(" ({kind})"))
        .unwrap_or_default();
    // The latest reset is when every exhausted window is usable again.
    let reached = windows
        .iter()
        .filter(|window| {
            window.used_percent >= 100.0 && window.resets_at.is_some_and(|at| at > 0.0)
        })
        .max_by(|a, b| {
            a.resets_at
                .partial_cmp(&b.resets_at)
                .unwrap_or(std::cmp::Ordering::Equal)
        });
    let Some(window) = reached else {
        let peak = windows
            .iter()
            .map(|window| window.used_percent)
            .reduce(f64::max)
            .map_or_else(
                || "no windows".to_string(),
                |peak| format!("peak used_percent {}", format_number(peak)),
            );
        return CodexLimitVerdict {
            reason: format!("no window at 100% with resets_at ({peak}){type_note}"),
            ..CodexLimitVerdict::default()
        };
    };
    let label = describe_window(window.window_minutes);
    #[allow(clippy::cast_possible_truncation)]
    let resets_at = window.resets_at.map(|at| at as i64);
    CodexLimitVerdict {
        reached: true,
        reason: format!(
            "{} {label} window at {}%{type_note}",
            window.name,
            format_number(window.used_percent)
        ),
        reset_time: resets_at.and_then(format_epoch_reset_time_utc),
        timezone: Some("UTC".to_string()),
        resets_at,
        window: Some(label),
        rollout_path: None,
    }
}

/// Usage-limit facts of a rollout's last turn
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct CodexRolloutLimitFacts {
    /// Newest `token_count.rate_limits` snapshot
    pub rate_limits: Option<Value>,
    /// Message of the newest usage-limit `error` event
    pub error_text: Option<String>,
    /// Its `codex_error_info`
    pub error_info: Option<Value>,
}

fn is_usage_limit_error_info(info: Option<&Value>) -> bool {
    match info {
        None | Some(Value::Null) => false,
        Some(Value::String(text)) => text.to_lowercase().contains("usage_limit_exceeded"),
        Some(value) => value
            .to_string()
            .to_lowercase()
            .contains("usage_limit_exceeded"),
    }
}

// The `event_msg` payload of one rollout line, if it is one.
fn rollout_event_payload(line: &str) -> Option<Value> {
    let mut entry: Value = serde_json::from_str(line).ok()?;
    if entry.get("type").and_then(Value::as_str) != Some("event_msg") {
        return None;
    }
    match entry.get_mut("payload").map(Value::take) {
        Some(payload) if payload.is_object() => Some(payload),
        _ => Some(entry),
    }
}

// Keep the newest rate_limits snapshot and usage-limit error of a turn.
fn collect_limit_fact(facts: &mut CodexRolloutLimitFacts, payload: &Value) {
    let kind = payload.get("type").and_then(Value::as_str);
    let rate_limits = payload.get("rate_limits").filter(|value| !value.is_null());
    if kind == Some("token_count") && rate_limits.is_some() {
        if facts.rate_limits.is_none() {
            facts.rate_limits = rate_limits.cloned();
        }
        return;
    }
    if kind != Some("error") || facts.error_text.is_some() {
        return;
    }
    let message = payload
        .get("message")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let info = payload
        .get("codex_error_info")
        .filter(|value| !value.is_null());
    if is_usage_limit_error_info(info) || is_usage_limit_text(message) {
        facts.error_text = Some(if message.is_empty() {
            "usage_limit_exceeded".to_string()
        } else {
            message.to_string()
        });
        facts.error_info = info.cloned();
    }
}

/// Collect usage-limit facts from a rollout's last turn (JSONL text)
pub fn codex_rollout_limit_facts(text: &str) -> CodexRolloutLimitFacts {
    let mut facts = CodexRolloutLimitFacts::default();
    for line in text.lines().rev() {
        let Some(payload) = rollout_event_payload(line) else {
            continue;
        };
        let kind = payload.get("type").and_then(Value::as_str);
        if kind.is_some_and(|kind| TURN_START_TYPES.contains(&kind)) {
            break;
        }
        collect_limit_fact(&mut facts, &payload);
    }
    facts
}

/// Read the last turn of a thread's rollout.
///
/// Returns the rollout path and its facts, or why no rollout was read.
pub fn read_codex_rollout_limit_facts(
    thread_id: &str,
    options: &CodexRolloutOptions,
) -> Result<(PathBuf, CodexRolloutLimitFacts), String> {
    if thread_id.is_empty() {
        return Err("no thread id".to_string());
    }
    let sessions_dir = codex_sessions_dir(options);
    let rollout_path = find_codex_rollout_file(&sessions_dir, thread_id)
        .ok_or_else(|| format!("no rollout under {}", sessions_dir.display()))?;
    let text =
        read_file_tail(&rollout_path, options.max_bytes()).map_err(|error| error.to_string())?;
    Ok((rollout_path, codex_rollout_limit_facts(&text)))
}

/// Usage-limit verdict from a thread's rollout.
///
/// Used for a failed Codex exit that did not report the limit itself
/// (hive-mind#3570).
pub fn detect_codex_rollout_usage_limit(
    thread_id: &str,
    options: &CodexRolloutOptions,
) -> CodexLimitVerdict {
    let (rollout_path, facts) = match read_codex_rollout_limit_facts(thread_id, options) {
        Ok(read) => read,
        Err(reason) => {
            return CodexLimitVerdict {
                reason,
                ..CodexLimitVerdict::default()
            }
        }
    };
    let snapshot = classify_codex_rate_limit_snapshot(facts.rate_limits.as_ref());
    if snapshot.reached {
        return CodexLimitVerdict {
            rollout_path: Some(rollout_path),
            ..snapshot
        };
    }
    CodexLimitVerdict {
        reached: facts.error_text.is_some(),
        reason: facts
            .error_text
            .map_or(snapshot.reason, |text| format!("rollout error: {text}")),
        rollout_path: Some(rollout_path),
        ..CodexLimitVerdict::default()
    }
}

/// Fill a failed Codex run's usage-limit fields from its rollout when the
/// output did not report the limit.
///
/// A killed process cannot report one, so signalled runs are skipped.
/// Returns whether the metadata changed.
pub fn apply_codex_rollout_usage_limit(
    metadata: &mut ResultMetadata,
    options: &CodexRolloutOptions,
) -> bool {
    let Some(thread_id) = metadata.session_id.clone().filter(|id| !id.is_empty()) else {
        return false;
    };
    if metadata.tool != "codex"
        || metadata.exit_code == 0
        || metadata.signal.is_some()
        || metadata.limit_reached
    {
        return false;
    }
    let verdict = detect_codex_rollout_usage_limit(&thread_id, options);
    if !verdict.reached {
        return false;
    }
    metadata.success = false;
    metadata.limit_reached = true;
    metadata.limit_reset_time = verdict.reset_time;
    metadata.limit_timezone = verdict.timezone;
    metadata.limit_resets_at = verdict.resets_at;
    metadata.limit_window = verdict.window;
    metadata.limit_source = Some(CODEX_ROLLOUT_LIMIT_SOURCE.to_string());
    true
}

/// Fill a Codex run's `usage_windows` from the newest `rate_limits` snapshot
/// in its rollout: `codex exec --json` does not stream the windows (issue #57).
///
/// Returns whether the metadata changed.
pub fn apply_codex_rollout_usage_windows(
    metadata: &mut ResultMetadata,
    options: &CodexRolloutOptions,
) -> bool {
    let Some(thread_id) = metadata.session_id.clone().filter(|id| !id.is_empty()) else {
        return false;
    };
    if metadata.tool != "codex" || !metadata.usage_windows.is_empty() {
        return false;
    }
    let Ok((_, facts)) = read_codex_rollout_limit_facts(&thread_id, options) else {
        return false;
    };
    metadata.usage_windows = codex_rate_limit_windows(facts.rate_limits.as_ref());
    !metadata.usage_windows.is_empty()
}
