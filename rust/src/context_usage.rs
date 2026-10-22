//! Context-window usage of a run (issue #57).
//!
//! Every Claude Code (and Qwen Code) `assistant` stream message carries the
//! request's `usage`; the prompt side (`input_tokens` +
//! `cache_creation_input_tokens` + `cache_read_input_tokens`) plus
//! `output_tokens` is what the next request has to carry. The `result`
//! message reports each model's `contextWindow` in `modelUsage`. Codex
//! reports `last_token_usage.total_tokens` and `model_context_window` in
//! rollout `token_count` events (`tokenUsage.last.totalTokens` and
//! `modelContextWindow` on the app-server). upcomputer draws its context
//! gauge from these numbers and hive-mind sizes sub-sessions and reports the
//! peak context from them.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// How full a run's context window is
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextUsage {
    /// Tokens the last main-thread request filled (prompt plus output)
    pub used_tokens: u64,
    /// Largest fill of any main-thread request
    pub peak_tokens: u64,
    /// The model's context window, when the tool reports it
    pub max_tokens: Option<u64>,
    /// `used_tokens` as a share of `max_tokens`, 0-100
    pub used_percent: Option<f64>,
    /// Model of the last request (Claude)
    pub model: Option<String>,
    /// How many times the tool compacted the conversation
    pub compactions: u64,
}

/// One request's context reading
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ContextReading {
    pub used_tokens: u64,
    pub max_tokens: Option<u64>,
    pub model: Option<String>,
}

fn count(value: Option<&Value>) -> u64 {
    value.and_then(Value::as_u64).unwrap_or(0)
}

fn positive(value: Option<&Value>) -> Option<u64> {
    Some(count(value)).filter(|number| *number > 0)
}

/// Tokens one Claude-style request fills: prompt (fresh, cache writes and
/// cache reads) plus its output.
pub fn claude_request_context_tokens(usage: &Value) -> u64 {
    [
        "input_tokens",
        "cache_creation_input_tokens",
        "cache_read_input_tokens",
        "output_tokens",
    ]
    .iter()
    .map(|key| count(usage.get(key)))
    .sum()
}

fn reading(
    used_tokens: u64,
    max_tokens: Option<u64>,
    model: Option<String>,
) -> Option<ContextReading> {
    (used_tokens > 0).then_some(ContextReading {
        used_tokens,
        max_tokens,
        model,
    })
}

/// The context reading one stream or rollout message carries.
///
/// Sub-agent messages (`parent_tool_use_id`) fill their own context.
pub fn context_reading_from_message(message: &Value) -> Option<ContextReading> {
    if message
        .get("parent_tool_use_id")
        .is_some_and(|id| !id.is_null())
    {
        return None;
    }
    let kind = message.get("type").and_then(Value::as_str);
    if kind == Some("assistant") {
        let inner = message.get("message")?;
        let model = inner.get("model").and_then(Value::as_str).map(String::from);
        return reading(
            claude_request_context_tokens(inner.get("usage")?),
            None,
            model,
        );
    }
    let payload = message.get("payload");
    let info = if kind == Some("token_count") {
        message.get("info")
    } else if payload.and_then(|p| p.get("type")).and_then(Value::as_str) == Some("token_count") {
        payload.and_then(|p| p.get("info"))
    } else {
        None
    };
    if let Some(info) = info.filter(|info| info.is_object()) {
        let used = count(info.pointer("/last_token_usage/total_tokens"));
        return reading(used, positive(info.get("model_context_window")), None);
    }
    let token_usage = message
        .pointer("/params/tokenUsage")
        .or_else(|| message.get("tokenUsage"))?;
    let used = count(token_usage.pointer("/last/totalTokens"));
    reading(used, positive(token_usage.get("modelContextWindow")), None)
}

// `modelUsage` entry for a model id; Claude may key it with a suffix.
fn context_window_for(model_usage: Option<&Value>, model: Option<&str>) -> Option<u64> {
    let entries: Vec<(&String, u64)> = model_usage?
        .as_object()?
        .iter()
        .filter_map(|(id, usage)| Some((id, positive(usage.get("contextWindow"))?)))
        .collect();
    let exact = model.and_then(|model| entries.iter().find(|(id, _)| id.as_str() == model));
    let prefix = model.and_then(|model| {
        entries
            .iter()
            .find(|(id, _)| id.starts_with(model) || model.starts_with(id.as_str()))
    });
    let only = (entries.len() == 1).then(|| &entries[0]);
    exact.or(prefix).or(only).map(|(_, window)| *window)
}

// Share of the window, rounded to 4 decimals; token counts fit an f64.
#[allow(clippy::cast_precision_loss)]
fn percent(used: u64, max: u64) -> f64 {
    (used as f64 / max as f64 * 1e6).round() / 1e4
}

/// Fold a run's context usage: the last request's fill, the peak fill, the
/// model's context window when reported, and the compaction count.
///
/// Returns `None` when the run reported no token usage.
pub fn extract_context_usage(messages: &[Value]) -> Option<ContextUsage> {
    let mut last: Option<ContextReading> = None;
    let mut peak_tokens = 0;
    let mut max_tokens = None;
    let mut compactions = 0;
    let mut model_usage = None;
    for message in messages {
        let kind = message.get("type").and_then(Value::as_str);
        if kind == Some("system")
            && message.get("subtype").and_then(Value::as_str) == Some("compact_boundary")
        {
            compactions += 1;
        }
        if kind == Some("result") {
            model_usage = message.get("modelUsage").or(model_usage);
        }
        if let Some(reading) = context_reading_from_message(message) {
            peak_tokens = peak_tokens.max(reading.used_tokens);
            max_tokens = reading.max_tokens.or(max_tokens);
            last = Some(reading);
        }
    }
    let last = last?;
    let max_tokens = max_tokens.or_else(|| context_window_for(model_usage, last.model.as_deref()));
    Some(ContextUsage {
        used_tokens: last.used_tokens,
        peak_tokens,
        max_tokens,
        used_percent: max_tokens.map(|max| percent(last.used_tokens, max)),
        model: last.model,
        compactions,
    })
}
