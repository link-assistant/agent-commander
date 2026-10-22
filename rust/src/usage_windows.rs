//! Normalized usage windows (issue #57).
//!
//! Claude Code streams `rate_limit_event.rate_limit_info` (one window per
//! event, `utilization` as a 0-1 fraction). Codex reports
//! `rate_limits.{primary,secondary}` in rollout `token_count` events
//! (`used_percent`, `window_minutes`, `resets_at`) and in app-server
//! `account/rateLimits/*` (`usedPercent`, `windowDurationMins`, `resetsAt`).
//! Both become one [`UsageWindow`] shape; `resets_at` stays in epoch seconds
//! like `limit_resets_at`.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

const SESSION_MINS: u64 = 5 * 60;
const WEEK_MINS: u64 = 7 * 24 * 60;
const MONTH_MINS: u64 = 30 * 24 * 60;

/// Window kinds, shortest first.
pub const USAGE_WINDOW_KINDS: &[&str] = &["session", "weekly", "monthly", "other"];

/// One provider usage window
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    /// Native window name (`five_hour`, `seven_day_opus`, `primary`, ...)
    pub id: String,
    /// `session`, `weekly`, `monthly` or `other`
    pub kind: String,
    pub label: String,
    /// Used share of the window, 0-100
    pub used_percent: f64,
    /// Reset epoch in seconds
    pub resets_at: Option<i64>,
    pub window_duration_mins: Option<u64>,
}

fn finite(value: Option<&Value>) -> Option<f64> {
    let number = match value? {
        Value::Number(number) => number.as_f64(),
        Value::String(text) => text.trim().parse::<f64>().ok(),
        _ => None,
    }?;
    number.is_finite().then_some(number)
}

/// Clamp to 0-100 and round to 4 decimals (0.41 * 100 is 41.00000000000001).
fn clamp_percent(value: f64) -> f64 {
    (value.clamp(0.0, 100.0) * 1e4).round() / 1e4
}

#[allow(clippy::cast_possible_truncation)]
fn epoch_seconds(value: Option<&Value>) -> Option<i64> {
    finite(value)
        .filter(|seconds| *seconds > 0.0)
        .map(|seconds| seconds as i64)
}

fn label_for(kind: &str) -> &'static str {
    match kind {
        "session" => "Session",
        "weekly" => "Weekly",
        "monthly" => "Monthly",
        _ => "Other",
    }
}

fn make_window(
    id: &str,
    kind: &str,
    label: Option<String>,
    used_percent: f64,
    resets_at: Option<&Value>,
    mins: Option<u64>,
) -> UsageWindow {
    UsageWindow {
        id: id.to_string(),
        kind: kind.to_string(),
        label: label.unwrap_or_else(|| label_for(kind).to_string()),
        used_percent: clamp_percent(used_percent),
        resets_at: epoch_seconds(resets_at),
        window_duration_mins: mins,
    }
}

/// Normalize one Claude `rate_limit_info`.
///
/// `five_hour` is the session window and every `seven_day*` type (all
/// models, per-model, overage-included) is a weekly window keyed by its type.
pub fn claude_rate_limit_windows(info: Option<&Value>) -> Vec<UsageWindow> {
    let Some(info) = info.filter(|info| info.is_object()) else {
        return Vec::new();
    };
    let kind = info.get("rateLimitType").and_then(Value::as_str);
    let (Some(kind), Some(utilization)) = (
        kind.filter(|kind| !kind.is_empty()),
        finite(info.get("utilization")),
    ) else {
        return Vec::new();
    };
    let resets_at = info.get("resetsAt");
    let used = utilization * 100.0;
    let window = if kind.starts_with("five_hour") {
        make_window(kind, "session", None, used, resets_at, Some(SESSION_MINS))
    } else if let Some(scope) = kind.strip_prefix("seven_day") {
        let scope = scope.strip_prefix('_').unwrap_or(scope);
        let label = if scope.is_empty() {
            "Weekly".to_string()
        } else {
            format!("Weekly · {scope}")
        };
        make_window(
            kind,
            "weekly",
            Some(label),
            used,
            resets_at,
            Some(WEEK_MINS),
        )
    } else {
        make_window(kind, "other", Some(kind.to_string()), used, resets_at, None)
    };
    vec![window]
}

const fn kind_for_minutes(mins: u64) -> &'static str {
    if mins >= MONTH_MINS {
        "monthly"
    } else if mins >= WEEK_MINS {
        "weekly"
    } else {
        "session"
    }
}

fn either<'a>(value: &'a Value, snake: &str, camel: &str) -> Option<&'a Value> {
    value
        .get(snake)
        .filter(|item| !item.is_null())
        .or_else(|| value.get(camel))
}

/// Normalize a Codex `rate_limits` snapshot (rollout snake_case or
/// app-server camelCase).
///
/// `primary` / `secondary` are positions, not durations: without a window
/// length, paid plans mean 5 hours / 1 week and Free or Go plans a monthly
/// primary allowance. Snapshots of another `limit_id` are skipped.
#[allow(clippy::cast_possible_truncation, clippy::cast_sign_loss)]
pub fn codex_rate_limit_windows(snapshot: Option<&Value>) -> Vec<UsageWindow> {
    let Some(snapshot) = snapshot.filter(|snapshot| snapshot.is_object()) else {
        return Vec::new();
    };
    let limit_id = either(snapshot, "limit_id", "limitId").and_then(Value::as_str);
    if limit_id.is_some_and(|id| !id.is_empty() && id != "codex") {
        return Vec::new();
    }
    let plan = either(snapshot, "plan_type", "planType").and_then(Value::as_str);
    let monthly_plan = matches!(plan, Some("free" | "go"));
    let positions = [
        (
            "primary",
            if monthly_plan {
                MONTH_MINS
            } else {
                SESSION_MINS
            },
        ),
        ("secondary", WEEK_MINS),
    ];
    let mut windows = Vec::new();
    for (id, fallback) in positions {
        let Some(window) = snapshot.get(id).filter(|window| window.is_object()) else {
            continue;
        };
        let Some(used) = finite(either(window, "used_percent", "usedPercent")) else {
            continue;
        };
        let mins = finite(either(window, "window_minutes", "windowDurationMins"))
            .map_or(fallback, |mins| mins.max(0.0) as u64);
        windows.push(make_window(
            id,
            kind_for_minutes(mins),
            None,
            used,
            either(window, "resets_at", "resetsAt"),
            Some(mins),
        ));
    }
    windows
}

fn kind_rank(kind: &str) -> usize {
    USAGE_WINDOW_KINDS
        .iter()
        .position(|known| *known == kind)
        .unwrap_or(USAGE_WINDOW_KINDS.len())
}

/// Merge a partial update into known windows by `id`.
///
/// Windows the update omits are kept (Claude names one window per event),
/// and so is a known reset the update leaves out. Sorted by kind, then id.
pub fn merge_usage_windows(windows: &[UsageWindow], update: &[UsageWindow]) -> Vec<UsageWindow> {
    let mut by_id: BTreeMap<String, UsageWindow> = windows
        .iter()
        .map(|window| (window.id.clone(), window.clone()))
        .collect();
    for window in update {
        let resets_at = window
            .resets_at
            .or_else(|| by_id.get(&window.id).and_then(|known| known.resets_at));
        by_id.insert(
            window.id.clone(),
            UsageWindow {
                resets_at,
                ..window.clone()
            },
        );
    }
    let mut merged: Vec<UsageWindow> = by_id.into_values().collect();
    merged.sort_by(|a, b| {
        kind_rank(&a.kind)
            .cmp(&kind_rank(&b.kind))
            .then_with(|| a.id.cmp(&b.id))
    });
    merged
}

/// The windows one stream or rollout message carries.
pub fn usage_windows_from_message(message: &Value) -> Vec<UsageWindow> {
    if !message.is_object() {
        return Vec::new();
    }
    if message.get("type").and_then(Value::as_str) == Some("rate_limit_event") {
        return claude_rate_limit_windows(message.get("rate_limit_info"));
    }
    let snapshot = message
        .get("rate_limits")
        .or_else(|| message.pointer("/payload/rate_limits"))
        .or_else(|| message.pointer("/params/rateLimits"))
        .or_else(|| message.get("rateLimits"));
    codex_rate_limit_windows(snapshot)
}

/// Fold every usage window a run reported, newest value per window.
pub fn extract_usage_windows(messages: &[Value]) -> Vec<UsageWindow> {
    messages.iter().fold(Vec::new(), |windows, message| {
        merge_usage_windows(&windows, &usage_windows_from_message(message))
    })
}
