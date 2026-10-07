//! Native terminal events, independent of process exit status.
use serde_json::Value;
pub fn completion_state(tool: &str, messages: &[Value]) -> Option<&'static str> {
    let mut state = None;
    for event in messages {
        if event
            .get("parent_tool_use_id")
            .is_some_and(|id| !id.is_null())
        {
            continue;
        }
        let kind = event["type"].as_str().unwrap_or("");
        if tool == "gemini"
            && kind.is_empty()
            && event["stats"].is_object()
            && (event.get("response").is_some() || event["error"].is_object())
        {
            state = Some(if event["error"].is_object() {
                "failed"
            } else {
                "completed"
            });
        }
        match tool {
            "codex" => match kind {
                "thread.started" | "turn.started" => state = Some("incomplete"),
                "turn.completed" => state = Some("completed"),
                "turn.failed" => state = Some("failed"),
                _ => {}
            },
            "opencode" | "agent" => match kind {
                "step_start" => state = Some("incomplete"),
                "step_finish" => {
                    state = Some(
                        if event.pointer("/part/reason").and_then(Value::as_str)
                            == Some("tool-calls")
                        {
                            "incomplete"
                        } else {
                            "completed"
                        },
                    );
                }
                _ => {}
            },
            _ => {
                if kind == "init"
                    || (kind == "system" && event["subtype"] == "init")
                    || kind == "assistant"
                {
                    state = Some("incomplete");
                }
                if kind == "result" {
                    let failed = event["is_error"] == true
                        || event["status"] == "error"
                        || event["subtype"]
                            .as_str()
                            .is_some_and(|s| s.starts_with("error"));
                    state = Some(if failed { "failed" } else { "completed" });
                }
            }
        }
    }
    state
}

pub fn outcome_messages<'a>(tool: &str, messages: &'a [Value]) -> &'a [Value] {
    if completion_state(tool, messages) != Some("completed") {
        return messages;
    }
    let terminal = messages
        .iter()
        .rposition(|event| completion_state(tool, std::slice::from_ref(event)) == Some("completed"))
        .unwrap_or(0);
    &messages[terminal..]
}

pub fn require_completed_result(
    metadata: &mut crate::result_metadata::ResultMetadata,
    tool: &str,
    messages: &[Value],
) {
    if metadata.success && completion_state(tool, messages) != Some("completed") {
        metadata.success = false;
        metadata.error_during_execution = true;
        metadata.error_type = Some("incomplete_stream".into());
        metadata.error_message = Some("Process exited before the native completion event".into());
    }
}
