//! Live input for a running agent (issue #57).
//!
//! Claude Code (`-p --input-format stream-json`), Qwen Code and
//! @link-assistant/agent (`--input-format stream-json`) keep reading NDJSON
//! user frames from stdin while they work, so a caller can queue follow-up
//! messages into the same session. upcomputer steers and queues messages into
//! running Claude turns, and hive-mind feeds new PR comments into a running
//! session; both need the same frames. Claude and Qwen also accept an
//! `interrupt` control request, which ends the running turn (the Claude Agent
//! SDK's `Query.interrupt()`).

use serde_json::{json, Value};
use std::sync::atomic::{AtomicU64, Ordering};

use crate::Agent;

static INTERRUPT_SEQUENCE: AtomicU64 = AtomicU64::new(0);

/// Tools whose stdin frames use the Anthropic message envelope and that
/// answer an `interrupt` control request.
fn uses_envelope(tool: &str) -> bool {
    matches!(tool, "claude" | "qwen")
}

/// Whether a tool reads live NDJSON user frames from stdin.
pub fn supports_live_input(tool: &str) -> bool {
    matches!(tool, "claude" | "qwen" | "agent")
}

/// Error text for tools without a live input channel.
pub fn live_input_unsupported_error(tool: &str) -> String {
    format!(
        "Tool \"{tool}\" does not read live input (no stream-json stdin channel). Choose one of: claude, qwen, agent; or run without live_input."
    )
}

/// Build one user-message frame.
///
/// `content` is text, or Anthropic content blocks (text, image) for Claude
/// and Qwen. `system_prompt` is prepended to text for qwen and agent, which
/// have no separate system-prompt channel on stdin.
pub fn build_user_input_frame(
    tool: &str,
    content: &Value,
    system_prompt: Option<&str>,
) -> Result<Value, String> {
    if tool == "claude" {
        let content = if content.is_null() {
            json!("")
        } else {
            content.clone()
        };
        return Ok(json!({"type": "user", "message": {"role": "user", "content": content}}));
    }
    if uses_envelope(tool) && content.is_array() {
        return Ok(json!({"type": "user", "message": {"role": "user", "content": content}}));
    }
    let text = match content {
        Value::String(text) => text.as_str(),
        Value::Null => "",
        _ => return Err(format!("Tool \"{tool}\" accepts only text live input")),
    };
    let text = system_prompt.map_or_else(|| text.to_string(), |sys| format!("{sys}\n\n{text}"));
    Ok(if uses_envelope(tool) {
        json!({"type": "user", "message": {"role": "user", "content": text}})
    } else {
        json!({"type": "user", "message": text})
    })
}

/// Build the control request that interrupts the running turn.
pub fn build_interrupt_frame(tool: &str, request_id: Option<&str>) -> Result<Value, String> {
    if !uses_envelope(tool) {
        return Err(format!(
            "Tool \"{tool}\" has no interrupt control request. Choose claude or qwen, or stop the agent instead."
        ));
    }
    let sequence = INTERRUPT_SEQUENCE.fetch_add(1, Ordering::Relaxed) + 1;
    let request_id = request_id.map_or_else(
        || format!("interrupt-{}-{sequence}", std::process::id()),
        str::to_string,
    );
    Ok(json!({
        "type": "control_request",
        "request_id": request_id,
        "request": {"subtype": "interrupt"}
    }))
}

impl Agent {
    pub(crate) async fn write_input_frame(&mut self, frame: &Value) -> Result<(), String> {
        if !self.options.live_input {
            return Err("Agent was not started with live_input".to_string());
        }
        let handle = self
            .process_handle
            .as_mut()
            .filter(|handle| handle.has_stdin())
            .ok_or("Agent input is closed (not started, ended, or stopped)")?;
        handle
            .write_stdin(&format!("{frame}\n"))
            .await
            .map_err(|error| error.to_string())
    }

    /// Queue a follow-up user message into the running session (requires
    /// [`crate::AgentOptions::live_input`]).
    ///
    /// `content` is text, or content blocks for Claude and Qwen. The tool
    /// reads it after (or, for Claude, alongside) the current turn.
    pub async fn send_message(&mut self, content: impl Into<Value>) -> Result<(), String> {
        let frame = build_user_input_frame(&self.options.tool, &content.into(), None)?;
        self.write_input_frame(&frame).await
    }

    /// Ask Claude or Qwen to end the running turn; queued messages still run.
    pub async fn interrupt(&mut self) -> Result<(), String> {
        let frame = build_interrupt_frame(&self.options.tool, None)?;
        self.write_input_frame(&frame).await
    }

    /// Close stdin: the tool finishes the queued input and exits.
    ///
    /// Returns whether input was open. `stop` and `cancel` also end it.
    pub fn end_input(&mut self) -> bool {
        self.process_handle
            .as_mut()
            .is_some_and(crate::ProcessHandle::end_stdin)
    }
}
