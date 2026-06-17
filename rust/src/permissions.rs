//! Permission normalization and relay for the uniform per-command approval
//! ("ask") mode.
//!
//! Each backend CLI that supports interactive, per-command approval exposes the
//! approval handshake over a different JSON wire format. This module translates
//! those native frames into a single normalized `permission_request` event and
//! translates a normalized decision (`once` | `always` | `reject`) back into the
//! native response frame that the CLI expects on its stdin.
//!
//! Only tools with a *drivable* JSON request/response permission protocol can be
//! relayed (see [`ASK_SUPPORTED_TOOLS`]). Tools whose only native approval
//! mechanism is a static policy (`opencode`), a sandbox coupling (`codex`), or a
//! non-streaming approval flag (`qwen`, `gemini`) are documented in the parity
//! table but fail clearly when ask mode is requested — mirroring the
//! `--read-only` unsupported-tool pattern.
//!
//! This is the Rust mirror of `js/src/permissions/`.

use crate::streaming::stringify_ndjson_line;
use serde_json::{json, Value};

/// Tools that expose a relayable per-command approval protocol over JSON.
pub const ASK_SUPPORTED_TOOLS: &[&str] = &["agent", "claude"];

/// Normalized decisions a consumer may return for a permission request.
pub const ASK_DECISIONS: &[&str] = &["once", "always", "reject"];

/// Scope of an `always` decision for each backend. The reviewer (m13v) flagged
/// that "always" does not mean the same thing across CLIs, so the normalized
/// event and the parity table both carry this scope.
///
/// - `session`    — `always` auto-approves later matching requests for the rest
///   of the session (agent's native `always`).
/// - `tool-input` — approval binds to the tool name + input shape; Claude has no
///   native session-wide `always`, so `once` and `always` both map to a single
///   allow decision bound to that tool call's input.
pub fn ask_scope(tool: &str) -> Option<&'static str> {
    match tool {
        "agent" => Some("session"),
        "claude" => Some("tool-input"),
        _ => None,
    }
}

/// Whether agent-commander can relay per-command approvals for the given tool.
pub fn supports_ask(tool: &str) -> bool {
    ASK_SUPPORTED_TOOLS.contains(&tool)
}

/// Build the standard error for tools without a relayable per-command approval
/// mechanism (ask mode). Mirrors [`crate::command_builder::read_only_unsupported_error`].
pub fn ask_unsupported_error(tool: &str) -> String {
    format!(
        "Tool \"{}\" does not support enforceable per-command approval (ask mode). Choose one of: {}; or run without --approve-each.",
        tool,
        ASK_SUPPORTED_TOOLS.join(", ")
    )
}

/// A normalized permission request, uniform across every relayable backend.
// `raw`/`input` carry `serde_json::Value`, which cannot implement `Eq`.
#[allow(clippy::derive_partial_eq_without_eq)]
#[derive(Debug, Clone, PartialEq)]
pub struct NormalizedPermissionRequest {
    /// Always `"permission_request"`.
    pub r#type: String,
    /// Backend tool name (`agent` | `claude`).
    pub tool: String,
    /// Opaque id used to correlate the response with this request.
    pub id: Option<String>,
    pub session_id: Option<String>,
    pub call_id: Option<String>,
    /// Native tool/action name (e.g. `bash`, `Edit`).
    pub tool_name: Option<String>,
    pub title: Option<String>,
    /// Best-effort human-readable command/target string.
    pub command: Option<String>,
    pub pattern: Option<String>,
    /// What an `always`/allow decision attaches to (see [`ask_scope`]).
    pub scope: String,
    /// Original tool input payload (Claude only), needed to echo `updatedInput`.
    pub input: Option<Value>,
    /// The raw native frame this was normalized from.
    pub raw: Value,
}

fn value_str(message: &Value, key: &str) -> Option<String> {
    message
        .get(key)
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

/// Derive a human-readable command string from a Claude tool input payload.
fn derive_claude_command(tool_name: Option<&str>, input: Option<&Value>) -> Option<String> {
    if let Some(input) = input {
        // Bash carries the literal shell command.
        for key in ["command", "file_path", "path", "url"] {
            if let Some(value) = input.get(key).and_then(|v| v.as_str()) {
                return Some(value.to_string());
            }
        }
    }
    tool_name.map(|s| s.to_string())
}

/// Normalize a native permission request frame into a uniform event.
///
/// Returns `None` when the message is not a permission request for the tool, so
/// callers can pass every parsed output message through unconditionally.
pub fn normalize_permission_request(
    tool: &str,
    message: &Value,
) -> Option<NormalizedPermissionRequest> {
    if !message.is_object() {
        return None;
    }

    if tool == "agent" {
        if message.get("type").and_then(|v| v.as_str()) != Some("permission_request") {
            return None;
        }
        let id = value_str(message, "permissionID").or_else(|| value_str(message, "permission_id"));
        let metadata = message.get("metadata").filter(|v| v.is_object());
        let title = value_str(message, "title");
        let command = metadata
            .and_then(|m| m.get("command"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| title.clone());
        let pattern = value_str(message, "pattern").or_else(|| {
            metadata
                .and_then(|m| m.get("patterns"))
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        });
        return Some(NormalizedPermissionRequest {
            r#type: "permission_request".to_string(),
            tool: "agent".to_string(),
            id,
            session_id: value_str(message, "sessionID")
                .or_else(|| value_str(message, "session_id")),
            call_id: value_str(message, "callID").or_else(|| value_str(message, "call_id")),
            tool_name: value_str(message, "tool"),
            title,
            command,
            pattern,
            scope: ask_scope("agent").unwrap().to_string(),
            input: None,
            raw: message.clone(),
        });
    }

    if tool == "claude" {
        let request = message.get("request");
        let is_can_use_tool = message.get("type").and_then(|v| v.as_str())
            == Some("control_request")
            && request
                .and_then(|r| r.get("subtype"))
                .and_then(|v| v.as_str())
                == Some("can_use_tool");
        if !is_can_use_tool {
            return None;
        }
        let request = request.unwrap();
        let tool_name = request
            .get("tool_name")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let input = request.get("input").filter(|v| v.is_object()).cloned();
        return Some(NormalizedPermissionRequest {
            r#type: "permission_request".to_string(),
            tool: "claude".to_string(),
            id: value_str(message, "request_id"),
            session_id: value_str(message, "session_id"),
            call_id: request
                .get("tool_use_id")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string()),
            tool_name: tool_name.clone(),
            title: tool_name.clone(),
            command: derive_claude_command(tool_name.as_deref(), input.as_ref()),
            pattern: None,
            scope: ask_scope("claude").unwrap().to_string(),
            input,
            raw: message.clone(),
        });
    }

    None
}

/// Build the native response frame for a normalized decision.
///
/// Returns `Err` for an invalid decision or an unsupported tool.
pub fn build_permission_response(
    tool: &str,
    request: &NormalizedPermissionRequest,
    decision: &str,
) -> Result<Value, String> {
    if !ASK_DECISIONS.contains(&decision) {
        return Err(format!(
            "Invalid permission decision \"{}\". Expected one of: once, always, reject.",
            decision
        ));
    }

    let id = request.id.clone().unwrap_or_default();

    if tool == "agent" {
        // Agent's native protocol accepts once | always | reject verbatim.
        return Ok(json!({
            "type": "permission_response",
            "permissionID": id,
            "response": decision,
        }));
    }

    if tool == "claude" {
        // Claude's stream-json control protocol expects an allow/deny behavior.
        // It has no native session-wide "always", so once and always both map to
        // a single allow bound to this tool call's input (scope: tool-input).
        if decision == "reject" {
            return Ok(json!({
                "type": "control_response",
                "response": {
                    "subtype": "success",
                    "request_id": id,
                    "response": {
                        "behavior": "deny",
                        "message": "Denied by consumer (ask mode).",
                    },
                },
            }));
        }
        let updated_input = request.input.clone().unwrap_or_else(|| json!({}));
        return Ok(json!({
            "type": "control_response",
            "response": {
                "subtype": "success",
                "request_id": id,
                "response": {
                    "behavior": "allow",
                    "updatedInput": updated_input,
                },
            },
        }));
    }

    Err(ask_unsupported_error(tool))
}

/// A single row of the per-command approval parity table.
#[derive(Debug, Clone)]
pub struct PermissionParityRow {
    pub tool: &'static str,
    pub native_mechanism: &'static str,
    pub scope: &'static str,
    pub relay: bool,
    pub notes: &'static str,
}

/// Parity description for each tool's native per-command approval mechanism.
///
/// Surfaced in the docs parity table; `scope` documents what an `always`/allow
/// decision attaches to, and `relay` indicates whether agent-commander can drive
/// the handshake as normalized JSON.
pub fn permission_parity() -> Vec<PermissionParityRow> {
    vec![
        PermissionParityRow {
            tool: "agent",
            native_mechanism: "--permission-mode ask (+ --input-format stream-json)",
            scope: "session",
            relay: true,
            notes: "Native JSON permission_request/permission_response protocol; once | always | reject map 1:1.",
        },
        PermissionParityRow {
            tool: "claude",
            native_mechanism: "--permission-mode default (stream-json can_use_tool)",
            scope: "tool-input",
            relay: true,
            notes: "control_request/control_response handshake; no session-wide always, so once and always both allow this call.",
        },
        PermissionParityRow {
            tool: "codex",
            native_mechanism: "--ask-for-approval (coupled with --sandbox)",
            scope: "sandbox-coupled",
            relay: false,
            notes: "Approval is coupled with the sandbox policy and not exposed as a tool-agnostic JSON request/response stream.",
        },
        PermissionParityRow {
            tool: "qwen",
            native_mechanism: "--approval-mode default",
            scope: "interactive-only",
            relay: false,
            notes: "Headless mode has no relayable per-command JSON approval handshake.",
        },
        PermissionParityRow {
            tool: "gemini",
            native_mechanism: "--approval-mode default",
            scope: "interactive-only",
            relay: false,
            notes: "No JSON stdin channel (prompt is passed via -p), so approvals cannot be relayed.",
        },
        PermissionParityRow {
            tool: "opencode",
            native_mechanism: "OPENCODE_PERMISSION (static {edit,bash,task} policy)",
            scope: "static-policy",
            relay: false,
            notes: "Only a static up-front policy is available; there is no per-command request/response relay.",
        },
    ]
}

/// Relay native permission requests to a consumer and forward decisions back.
///
/// A `PermissionRelay` sits between a backend CLI's streaming output and a
/// consumer: it watches parsed output messages for native permission requests,
/// normalizes them, asks the consumer for a decision, and writes the native
/// response frame back to the CLI's stdin as NDJSON.
///
/// The relay is intentionally transport-agnostic — it does not own the child
/// process. The caller supplies a `write` closure (typically the child's stdin)
/// and feeds it parsed messages, which keeps it fully unit-testable.
pub struct PermissionRelay<'a> {
    tool: String,
    on_request: Box<dyn FnMut(&NormalizedPermissionRequest) -> String + 'a>,
    write: Box<dyn FnMut(&str) + 'a>,
    compact: bool,
    handled: Vec<(NormalizedPermissionRequest, String, Value)>,
}

impl<'a> PermissionRelay<'a> {
    /// Create a new relay.
    ///
    /// * `on_request` resolves a normalized request to a decision
    ///   (`once` | `always` | `reject`).
    /// * `write` receives a serialized NDJSON frame to forward to the tool stdin.
    pub fn new<F, W>(tool: &str, on_request: F, write: W) -> Self
    where
        F: FnMut(&NormalizedPermissionRequest) -> String + 'a,
        W: FnMut(&str) + 'a,
    {
        Self {
            tool: tool.to_string(),
            on_request: Box::new(on_request),
            write: Box::new(write),
            compact: true,
            handled: Vec::new(),
        }
    }

    /// Process a single parsed output message. When the message is a permission
    /// request, resolves the consumer's decision and writes the native response.
    /// Returns the normalized request and the applied decision, or `None` when the
    /// message is not a permission request.
    pub fn handle_message(
        &mut self,
        message: &Value,
    ) -> Option<(NormalizedPermissionRequest, String)> {
        let request = normalize_permission_request(&self.tool, message)?;

        let mut decision = (self.on_request)(&request);
        // Default to the safe choice if the consumer returns nothing usable.
        if !ASK_DECISIONS.contains(&decision.as_str()) {
            decision = "reject".to_string();
        }

        // build_permission_response only fails for unsupported tools / decisions,
        // both of which are excluded above, so the frame is always available here.
        let frame = build_permission_response(&self.tool, &request, &decision)
            .expect("relayable tool with validated decision");
        (self.write)(&stringify_ndjson_line(&frame, self.compact));

        self.handled
            .push((request.clone(), decision.clone(), frame));
        Some((request, decision))
    }

    /// All permission requests handled so far (for inspection/testing).
    pub fn get_handled(&self) -> &[(NormalizedPermissionRequest, String, Value)] {
        &self.handled
    }
}
