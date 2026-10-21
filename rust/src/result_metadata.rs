//! Normalized result metadata for tool-specific agent output.

use crate::completion::{completion_state, outcome_messages};
use crate::error_text::first_error_text;
use crate::usage_limit::{
    classify_debug_lines, detect_usage_limit_sources, is_recoverable_tool_error, split_output,
    UsageLimitVerdict,
};
use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::sync::LazyLock;

/// Pricing details derived from a tool's public pricing estimate.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PricingInfo {
    pub total_cost_usd: f64,
    pub source: String,
}

/// Stable metadata that summarizes a completed agent run across tools.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultMetadata {
    pub tool: String,
    pub exit_code: i32,
    pub success: bool,
    pub session_id: Option<String>,
    pub limit_reached: bool,
    pub limit_reset_time: Option<String>,
    pub limit_timezone: Option<String>,
    /// Exact reset epoch (seconds) when a structured source reports one
    pub limit_resets_at: Option<i64>,
    /// Limit window from a structured source (`five_hour`, `seven_day`, ...)
    pub limit_window: Option<String>,
    pub anthropic_total_cost_usd: Option<f64>,
    pub public_pricing_estimate: Option<f64>,
    pub pricing_info: Option<PricingInfo>,
    pub result_summary: Option<String>,
    pub result_model_usage: Option<Value>,
    pub stream_token_usage: Option<Value>,
    pub sub_agent_calls: Option<Vec<Value>>,
    pub error_during_execution: bool,
    pub error_type: Option<String>,
    pub error_message: Option<String>,
}

/// Inputs used to build normalized result metadata.
#[derive(Debug, Clone)]
pub struct BuildMetadataOptions<'a> {
    pub tool: &'a str,
    pub exit_code: i32,
    pub plain_output: &'a str,
    pub parsed_output: Option<&'a [Value]>,
    pub session_id: Option<String>,
    pub usage: Option<Value>,
}

#[derive(Debug, Clone, Default)]
struct ExecutionError {
    has_error: bool,
    error_type: Option<String>,
    message: Option<String>,
}

fn parse_json_messages(output: &str) -> Vec<Value> {
    crate::streaming::parse_json_records(output)
        .into_iter()
        .flat_map(|value| match value {
            Value::Array(values) => values,
            message => vec![message],
        })
        .collect()
}

fn text_from_value(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(text)) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                None
            } else {
                Some(trimmed.to_string())
            }
        }
        Some(Value::Array(values)) => {
            let text = values
                .iter()
                .filter_map(|item| text_from_value(Some(item)))
                .collect::<Vec<_>>()
                .join("\n");
            if text.trim().is_empty() {
                None
            } else {
                Some(text)
            }
        }
        Some(Value::Object(map)) => {
            for key in ["text", "content", "result", "summary", "message"] {
                if let Some(text) = text_from_value(map.get(key)) {
                    return Some(text);
                }
            }
            None
        }
        _ => None,
    }
}

fn tail_chars(value: &str, max_chars: usize) -> String {
    let chars = value.chars().collect::<Vec<_>>();
    let start = chars.len().saturating_sub(max_chars);
    chars[start..].iter().collect()
}

fn extract_result_summary(messages: &[Value], plain_output: &str) -> Option<String> {
    let keys = [
        "result",
        "response",
        "summary",
        "result_summary",
        "resultSummary",
        "final_answer",
        "finalAnswer",
        "text",
        "content",
        "message",
    ];

    for message in messages.iter().rev() {
        if !message.is_object() {
            continue;
        }

        for key in keys {
            if let Some(text) = text_from_value(message.get(key)) {
                return Some(text);
            }
        }

        let nested_text = text_from_value(message.pointer("/part/text"))
            .or_else(|| text_from_value(message.pointer("/item/content")))
            .or_else(|| text_from_value(message.pointer("/item/text")))
            .or_else(|| text_from_value(message.pointer("/delta/text")));
        if nested_text.is_some() {
            return nested_text;
        }
    }

    let trimmed = plain_output.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(tail_chars(trimmed, 4000))
    }
}

fn first_number(messages: &[Value], keys: &[&str]) -> Option<f64> {
    for message in messages.iter().rev() {
        for key in keys {
            if let Some(value) = message.get(*key).and_then(Value::as_f64) {
                return Some(value);
            }
        }
    }

    None
}

fn extract_result_model_usage(messages: &[Value]) -> Option<Value> {
    for message in messages.iter().rev() {
        for key in [
            "resultModelUsage",
            "result_model_usage",
            "modelUsage",
            "model_usage",
            "usage_by_model",
        ] {
            if let Some(value) = message.get(key) {
                if value.is_object() {
                    return Some(value.clone());
                }
            }
        }
    }

    if let Some(models) = messages
        .iter()
        .rev()
        .find_map(|m| m.pointer("/stats/models"))
    {
        return Some(models.clone());
    }
    let mut usage_by_model = Map::new();
    for message in messages {
        let model = message
            .get("model")
            .or_else(|| message.pointer("/message/model"))
            .or_else(|| message.pointer("/part/model"))
            .and_then(Value::as_str);
        let usage = message
            .get("usage")
            .or_else(|| message.pointer("/message/usage"))
            .or_else(|| message.pointer("/part/tokens"));

        if let (Some(model), Some(usage)) = (model, usage) {
            let entry = usage_by_model
                .entry(model.to_string())
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Value::Array(values) = entry {
                values.push(usage.clone());
            }
        }
    }

    if usage_by_model.is_empty() {
        None
    } else {
        Some(Value::Object(usage_by_model))
    }
}

fn extract_sub_agent_calls(messages: &[Value]) -> Option<Vec<Value>> {
    let mut calls = Vec::new();

    for message in messages {
        for key in [
            "subAgentCalls",
            "sub_agent_calls",
            "subAgents",
            "sub_agents",
        ] {
            if let Some(Value::Array(values)) = message.get(key) {
                calls.extend(values.iter().cloned());
            }
        }

        if let Some(blocks) = message
            .pointer("/message/content")
            .and_then(Value::as_array)
        {
            for block in blocks {
                if block["type"] == "tool_use"
                    && matches!(block["name"].as_str(), Some("Task" | "Agent"))
                {
                    calls.push(json!({
                        "type": "tool_use",
                        "id": block["id"],
                        "name": block["name"],
                        "status": "started",
                        "summary": block.pointer("/input/description"),
                    }));
                }
            }
        }

        let message_type = message
            .pointer("/item/type")
            .or_else(|| message.get("type"))
            .or_else(|| message.get("item_type"))
            .and_then(Value::as_str);
        if let Some(message_type) = message_type {
            let lower = message_type.to_ascii_lowercase();
            if lower.contains("sub_agent")
                || lower.contains("sub-agent")
                || lower.contains("subagent")
                || lower.contains("collab")
            {
                calls.push(json!({
                    "type": message_type,
                    "id": message
                        .get("id")
                        .or_else(|| message.get("call_id"))
                        .or_else(|| message.pointer("/item/id"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "name": message
                        .get("name")
                        .or_else(|| message.get("tool"))
                        .or_else(|| message.pointer("/item/name"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "status": message
                        .pointer("/item/status")
                        .or_else(|| message.get("status"))
                        .or_else(|| message.get("state"))
                        .cloned()
                        .unwrap_or(Value::Null),
                    "summary": extract_result_summary(std::slice::from_ref(message), ""),
                }));
            }
        }
    }

    if calls.is_empty() {
        None
    } else {
        Some(calls)
    }
}

/// Claude's synthetic API error message carries the error code as a string
/// (`"error":"rate_limit"`) and the readable text in its content.
fn api_error_code(messages: &[Value]) -> Option<&str> {
    messages
        .iter()
        .rev()
        .find(|event| {
            event["type"] == "assistant"
                && event["is_api_error_message"] == true
                && event["error"].is_string()
        })
        .and_then(|event| event["error"].as_str())
}

fn non_empty_str(value: Option<&Value>) -> Option<&str> {
    value
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

fn extract_error_from_messages(messages: &[Value]) -> ExecutionError {
    let code = api_error_code(messages);
    for message in messages.iter().rev() {
        if !message.is_object() || is_recoverable_tool_error(message) {
            // A failed tool call is returned to the model; it does not decide the run.
            continue;
        }
        let message_type = non_empty_str(message.get("type"))
            .or_else(|| non_empty_str(message.get("subtype")))
            .or_else(|| non_empty_str(message.pointer("/item/type")));
        let is_error = message.get("is_error").and_then(Value::as_bool) == Some(true)
            || message
                .get("error")
                .is_some_and(|e| !e.is_null() && e != &Value::Bool(false) && e != "")
            || matches!(message_type, Some("error" | "step_error" | "turn.failed"))
            || message["status"] == "error"
            || message["subtype"]
                .as_str()
                .is_some_and(|s| s.starts_with("error"));

        if !is_error {
            continue;
        }

        let error = message.get("error");
        let object_error = error.filter(|value| value.is_object());
        let string_error = non_empty_str(error);
        let error_type = object_error
            .and_then(|value| {
                ["type", "code", "name"]
                    .iter()
                    .find_map(|key| non_empty_str(value.get(*key)))
            })
            .or(string_error)
            .or_else(|| non_empty_str(message.get("errorType")))
            .or_else(|| non_empty_str(message.get("error_type")))
            .or_else(|| {
                (message_type == Some("result"))
                    .then(|| non_empty_str(message.get("api_error")).or(code))
                    .flatten()
            })
            .or(message_type)
            .unwrap_or("execution_error")
            .to_string();
        let error_message = object_error
            .map(|value| first_error_text(&[value], ""))
            .filter(|text| !text.is_empty())
            .or_else(|| text_from_value(message.get("message")))
            .or_else(|| text_from_value(message.get("result")))
            .or_else(|| string_error.map(ToString::to_string))
            .unwrap_or_else(|| "Execution failed".to_string());

        return ExecutionError {
            has_error: true,
            error_type: Some(error_type),
            message: Some(error_message),
        };
    }

    ExecutionError::default()
}

static PREFERRED_EXIT_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"(?i)^(?:error\b|fatal:|(?:/\S*/)?(?:ba|z)?sh:\s)").expect("valid pattern")
});

/// The reason a process exited is a plain text line: JSON records, the
/// `ANTHROPIC_LOG=debug` dump and its base64 bodies are not (hive-mind#3570).
fn exit_reason_line(plain_output: &str) -> Option<String> {
    let (_, lines) = split_output(plain_output);
    let debug = classify_debug_lines(&lines);
    let candidates: Vec<&str> = lines
        .iter()
        .enumerate()
        .filter(|(index, _)| !debug.debug_lines.contains(index))
        .map(|(_, line)| line.trim())
        .filter(|line| !line.is_empty())
        .collect();
    candidates
        .iter()
        .rev()
        .find(|line| PREFERRED_EXIT_LINE.is_match(line))
        .or_else(|| candidates.last())
        .map(|line| (*line).to_string())
}

fn detect_execution_error(
    tool: &str,
    exit_code: i32,
    plain_output: &str,
    messages: &[Value],
) -> ExecutionError {
    if tool == "agent" {
        let detected = crate::tools::agent::detect_errors(
            &messages
                .iter()
                .map(Value::to_string)
                .collect::<Vec<_>>()
                .join("\n"),
        );
        if detected.has_error {
            return ExecutionError {
                has_error: true,
                error_type: detected
                    .error_type
                    .or_else(|| Some("execution_error".to_string())),
                message: detected
                    .message
                    .or_else(|| Some("Execution failed".to_string())),
            };
        }
    }

    let message_error = extract_error_from_messages(messages);
    if message_error.has_error {
        return message_error;
    }

    if exit_code != 0 {
        return ExecutionError {
            has_error: true,
            error_type: Some("exit_code".to_string()),
            message: exit_reason_line(plain_output)
                .or_else(|| Some(format!("Process exited with code {exit_code}"))),
        };
    }

    ExecutionError::default()
}

fn extract_session_id(explicit_session_id: Option<String>, messages: &[Value]) -> Option<String> {
    if explicit_session_id.is_some() {
        return explicit_session_id;
    }

    for message in messages {
        for key in [
            "session_id",
            "sessionId",
            "sessionID",
            "thread_id",
            "threadId",
            "conversation_id",
            "conversationId",
        ] {
            if let Some(session_id) = message.get(key).and_then(Value::as_str) {
                return Some(session_id.to_string());
            }
        }
    }

    None
}

fn public_pricing_estimate(tool: &str, usage: Option<&Value>) -> Option<f64> {
    if tool != "agent" && tool != "opencode" {
        return None;
    }

    usage
        .and_then(|value| value.get("totalCost").or_else(|| value.get("totalCostUSD")))
        .and_then(Value::as_f64)
}

/// Build stable, caller-facing metadata from tool-specific agent output.
pub fn build_normalized_result_metadata(options: BuildMetadataOptions<'_>) -> ResultMetadata {
    let all_messages = options.parsed_output.map_or_else(
        || parse_json_messages(options.plain_output),
        <[Value]>::to_vec,
    );
    let messages: Vec<_> = all_messages
        .iter()
        .filter(|event| event["parent_tool_use_id"].is_null())
        .cloned()
        .collect();
    let completion = completion_state(options.tool, &messages);
    // The raw stream contains HTTP header names (e.g.
    // "anthropic-ratelimit-unified-5h-reset") even on a successful run, so a
    // native completion event wins over the text scan (issue #37).
    let usage_limit = if completion == Some("completed") {
        UsageLimitVerdict::default()
    } else {
        detect_usage_limit_sources(options.plain_output, &messages)
    };
    let mut execution_error = detect_execution_error(
        options.tool,
        options.exit_code,
        options.plain_output,
        outcome_messages(options.tool, &messages),
    );
    if !execution_error.has_error && completion == Some("incomplete") {
        execution_error = ExecutionError {
            has_error: true,
            error_type: Some("incomplete_stream".into()),
            message: Some("Process exited before the native completion event".into()),
        };
    }
    // A server-side throttle is transient: callers retry instead of waiting for a reset.
    if execution_error.has_error && usage_limit.throttled {
        execution_error.error_type = Some("rate_limited".into());
    }
    let session_id = extract_session_id(options.session_id, &messages);
    let public_pricing_estimate = public_pricing_estimate(options.tool, options.usage.as_ref());
    let pricing_info = public_pricing_estimate.map(|total_cost_usd| PricingInfo {
        total_cost_usd,
        source: format!("{}-stream-usage", options.tool),
    });

    ResultMetadata {
        tool: options.tool.to_string(),
        exit_code: options.exit_code,
        success: options.exit_code == 0 && !usage_limit.reached && !execution_error.has_error,
        session_id,
        limit_reached: usage_limit.reached,
        limit_reset_time: usage_limit.reset_time,
        limit_timezone: usage_limit.timezone,
        limit_resets_at: usage_limit.resets_at,
        limit_window: usage_limit.window,
        anthropic_total_cost_usd: first_number(
            &messages,
            &["total_cost_usd", "totalCostUsd", "anthropicTotalCostUSD"],
        ),
        public_pricing_estimate,
        pricing_info,
        result_summary: extract_result_summary(&messages, options.plain_output),
        result_model_usage: extract_result_model_usage(&messages),
        stream_token_usage: options.usage,
        sub_agent_calls: extract_sub_agent_calls(&all_messages),
        error_during_execution: execution_error.has_error,
        error_type: execution_error.error_type,
        error_message: execution_error.message,
    }
}

#[cfg(test)]
mod tests {
    use super::{build_normalized_result_metadata, BuildMetadataOptions};
    use serde_json::json;

    #[test]
    fn normalizes_codex_thread_id_and_usage() {
        let usage = json!({
            "inputTokens": 12,
            "outputTokens": 4,
        });
        let metadata = build_normalized_result_metadata(BuildMetadataOptions {
            tool: "codex",
            exit_code: 0,
            plain_output:
                "{\"type\":\"session\",\"thread_id\":\"thread-123\"}\n{\"type\":\"message\",\"content\":\"Done.\"}",
            parsed_output: None,
            session_id: None,
            usage: Some(usage.clone()),
        });

        assert_eq!(metadata.tool, "codex");
        assert!(metadata.success);
        assert_eq!(metadata.session_id, Some("thread-123".to_string()));
        assert_eq!(metadata.result_summary, Some("Done.".to_string()));
        assert_eq!(metadata.stream_token_usage, Some(usage));
    }

    #[test]
    fn exposes_agent_pricing_and_sub_agent_calls() {
        let messages = vec![
            json!({
                "type": "collab_tool_call",
                "id": "call-1",
                "name": "worker",
                "status": "completed",
                "summary": "Worker finished."
            }),
            json!({
                "type": "message",
                "text": "Final summary."
            }),
        ];
        let usage = json!({
            "inputTokens": 100,
            "outputTokens": 40,
            "totalCost": 0.004,
            "stepCount": 1
        });
        let metadata = build_normalized_result_metadata(BuildMetadataOptions {
            tool: "agent",
            exit_code: 0,
            plain_output: "",
            parsed_output: Some(&messages),
            session_id: None,
            usage: Some(usage.clone()),
        });

        assert_eq!(metadata.tool, "agent");
        assert!(metadata.success);
        assert_eq!(metadata.public_pricing_estimate, Some(0.004));
        assert_eq!(
            metadata
                .pricing_info
                .as_ref()
                .map(|pricing| pricing.source.as_str()),
            Some("agent-stream-usage")
        );
        assert_eq!(metadata.result_summary, Some("Final summary.".to_string()));
        let sub_agent_calls = metadata.sub_agent_calls.unwrap();
        assert_eq!(sub_agent_calls.len(), 1);
        assert_eq!(sub_agent_calls[0].get("id"), Some(&json!("call-1")));
    }
}
