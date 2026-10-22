//! Structured output: the final answer shaped by the `json_schema` launch
//! option (issue #57).
//!
//! Claude reports it as `structured_output` and Qwen as
//! `structured_result` on the result message. Codex `--output-schema` shapes
//! the final agent message, which is JSON text.

use serde_json::Value;

fn parse_json_text(text: &str) -> Option<Value> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    serde_json::from_str(trimmed).ok()
}

/// Text of the last Codex `agent_message` item.
fn last_codex_agent_message(messages: &[Value]) -> Option<&str> {
    messages.iter().rev().find_map(|message| {
        let item = &message["item"];
        (message["type"] == "item.completed" && item["type"] == "agent_message")
            .then(|| item["text"].as_str())
            .flatten()
    })
}

/// Extract the structured output of a run.
///
/// `requested` (a `json_schema` was passed) enables reading Codex's final
/// message, which has no structured field. `codex exec --json` streams items;
/// without `--json` stdout is the final message itself.
pub fn extract_structured_output(
    tool: &str,
    messages: &[Value],
    plain_output: &str,
    requested: bool,
) -> Option<Value> {
    let structured = messages
        .iter()
        .rev()
        .filter(|message| message["type"] == "result")
        .find_map(|message| {
            ["structured_output", "structured_result"]
                .iter()
                .find_map(|key| message.get(*key).cloned())
        });
    if structured.is_some() || !requested || tool != "codex" {
        return structured;
    }
    parse_json_text(last_codex_agent_message(messages).unwrap_or(plain_output))
}
