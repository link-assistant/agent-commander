//! Normalize native snapshots and final totals without counting both.
use serde_json::Value;
use std::collections::BTreeMap;

pub fn records<'a>(tool: &str, messages: &'a [Value]) -> Vec<&'a Value> {
    if tool == "gemini" {
        if let Some(stats) = messages.iter().rev().find_map(|m| {
            m.get("stats")
                .filter(|_| m["type"] == "result" || m.get("response").is_some())
        }) {
            return stats.get("models").and_then(Value::as_object).map_or_else(
                || vec![stats],
                |models| models.values().filter_map(|m| m.get("tokens")).collect(),
            );
        }
    }
    if tool == "claude" || tool == "qwen" {
        if let Some(usage) = messages
            .iter()
            .rev()
            .filter(|m| m["type"] == "result" && m["parent_tool_use_id"].is_null())
            .find_map(|m| m.get("usage").or_else(|| m.pointer("/result/usage")))
        {
            return vec![usage];
        }
    }
    let mut snapshots = BTreeMap::new();
    let mut anonymous = Vec::new();
    for event in messages {
        if event
            .get("parent_tool_use_id")
            .is_some_and(|id| !id.is_null())
        {
            continue;
        }
        if let Some(usage) = event
            .get("usage")
            .or_else(|| event.pointer("/message/usage"))
            .or_else(|| event.pointer("/result/usage"))
            .or_else(|| event.get("usageMetadata"))
        {
            if let Some(id) = event.pointer("/message/id").and_then(Value::as_str) {
                snapshots.insert(id, usage);
            } else {
                anonymous.push(usage);
            }
        }
    }
    anonymous.extend(snapshots.values().copied());
    anonymous
}

pub fn count(record: &Value, fields: &[&str]) -> u64 {
    fields
        .iter()
        .find_map(|path| {
            path.split('.')
                .try_fold(record, |value, key| value.get(key))
                .and_then(Value::as_u64)
        })
        .unwrap_or(0)
}
pub const INPUT: &[&str] = &[
    "input_tokens",
    "promptTokens",
    "inputTokens",
    "input",
    "prompt_tokens",
    "prompt",
    "promptTokenCount",
];
pub const OUTPUT: &[&str] = &[
    "output_tokens",
    "completionTokens",
    "outputTokens",
    "output",
    "completion_tokens",
    "completion",
    "candidates",
    "candidatesTokenCount",
];
pub const CACHE_READ: &[&str] = &[
    "cached_input_tokens",
    "cachedInputTokens",
    "cache_read_tokens",
    "input_tokens_details.cached_tokens",
    "input_tokens_details.cache_read_tokens",
    "cache_read_input_tokens",
    "cacheReadTokens",
    "cacheRead",
    "cache_read",
    "cached",
    "cachedContentTokenCount",
    "prompt_tokens_details.cached_tokens",
    "cache.read",
];
pub const CACHE_WRITE: &[&str] = &[
    "cache_creation_input_tokens",
    "cacheCreationTokens",
    "cacheCreationInputTokens",
    "cache_write_tokens",
    "input_tokens_details.cache_write_tokens",
    "input_tokens_details.cache_creation_tokens",
    "input_tokens_details.cache_creation_input_tokens",
    "cacheWriteTokens",
    "cacheWrite",
    "cache_write",
    "cache.write",
];
pub const REASONING: &[&str] = &[
    "reasoning_output_tokens",
    "thoughtsTokens",
    "thoughts_tokens",
    "output_tokens_details.reasoning_tokens",
    "reasoning_tokens",
    "reasoningTokens",
    "reasoning",
    "thoughts",
    "thoughtsTokenCount",
];
pub const TOTAL: &[&str] = &["total_tokens", "totalTokens", "total", "totalTokenCount"];
