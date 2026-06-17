//! Tests for the uniform per-command approval ("ask" mode) permission relay.
//! Rust mirror of `js/test/permissions.test.mjs`.

use agent_commander::{
    ask_scope, ask_unsupported_error, build_permission_response, normalize_permission_request,
    permission_parity, supports_ask, NormalizedPermissionRequest, PermissionRelay, ASK_DECISIONS,
    ASK_SUPPORTED_TOOLS,
};
use serde_json::json;

#[test]
fn supports_ask_only_agent_and_claude_are_relayable() {
    assert!(supports_ask("agent"));
    assert!(supports_ask("claude"));
    assert!(!supports_ask("codex"));
    assert!(!supports_ask("qwen"));
    assert!(!supports_ask("gemini"));
    assert!(!supports_ask("opencode"));
    assert_eq!(ASK_SUPPORTED_TOOLS, &["agent", "claude"]);
}

#[test]
fn ask_unsupported_error_mentions_tool_and_supported_tools() {
    let message = ask_unsupported_error("codex");
    assert!(message.contains("Tool \"codex\""));
    assert!(message.contains("per-command approval"));
    assert!(message.contains("agent, claude"));
    assert!(message.contains("--approve-each"));
}

#[test]
fn ask_decisions_exactly_once_always_reject() {
    let mut decisions = ASK_DECISIONS.to_vec();
    decisions.sort_unstable();
    assert_eq!(decisions, vec!["always", "once", "reject"]);
}

#[test]
fn ask_scope_documents_per_backend_always_semantics() {
    assert_eq!(ask_scope("agent"), Some("session"));
    assert_eq!(ask_scope("claude"), Some("tool-input"));
    assert_eq!(ask_scope("codex"), None);
}

#[test]
fn normalize_agent_permission_request() {
    let message = json!({
        "type": "permission_request",
        "permissionID": "perm-1",
        "sessionID": "sess-1",
        "callID": "call-1",
        "tool": "bash",
        "title": "Run a command",
        "pattern": "rm *",
        "metadata": { "command": "rm -rf build" },
    });

    let normalized = normalize_permission_request("agent", &message).unwrap();
    assert_eq!(normalized.r#type, "permission_request");
    assert_eq!(normalized.tool, "agent");
    assert_eq!(normalized.id.as_deref(), Some("perm-1"));
    assert_eq!(normalized.session_id.as_deref(), Some("sess-1"));
    assert_eq!(normalized.call_id.as_deref(), Some("call-1"));
    assert_eq!(normalized.tool_name.as_deref(), Some("bash"));
    assert_eq!(normalized.title.as_deref(), Some("Run a command"));
    assert_eq!(normalized.command.as_deref(), Some("rm -rf build"));
    assert_eq!(normalized.pattern.as_deref(), Some("rm *"));
    assert_eq!(normalized.scope, "session");
    assert_eq!(normalized.input, None);
    assert_eq!(normalized.raw, message);
}

#[test]
fn normalize_agent_snake_case_permission_id_fallback() {
    let normalized = normalize_permission_request(
        "agent",
        &json!({ "type": "permission_request", "permission_id": "perm-2", "tool": "edit" }),
    )
    .unwrap();
    assert_eq!(normalized.id.as_deref(), Some("perm-2"));
    assert_eq!(normalized.tool_name.as_deref(), Some("edit"));
}

#[test]
fn normalize_agent_ignores_non_permission_messages() {
    assert!(normalize_permission_request("agent", &json!({ "type": "step_finish" })).is_none());
}

#[test]
fn normalize_claude_can_use_tool_control_request() {
    let message = json!({
        "type": "control_request",
        "request_id": "req-9",
        "session_id": "sess-9",
        "request": {
            "subtype": "can_use_tool",
            "tool_use_id": "tu-9",
            "tool_name": "Bash",
            "input": { "command": "npm test" },
        },
    });

    let normalized = normalize_permission_request("claude", &message).unwrap();
    assert_eq!(normalized.tool, "claude");
    assert_eq!(normalized.id.as_deref(), Some("req-9"));
    assert_eq!(normalized.session_id.as_deref(), Some("sess-9"));
    assert_eq!(normalized.call_id.as_deref(), Some("tu-9"));
    assert_eq!(normalized.tool_name.as_deref(), Some("Bash"));
    assert_eq!(normalized.command.as_deref(), Some("npm test"));
    assert_eq!(normalized.scope, "tool-input");
    assert_eq!(normalized.input, Some(json!({ "command": "npm test" })));
}

#[test]
fn normalize_claude_derives_command_from_file_path() {
    let normalized = normalize_permission_request(
        "claude",
        &json!({
            "type": "control_request",
            "request_id": "req-10",
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Edit",
                "input": { "file_path": "/tmp/a.txt" },
            },
        }),
    )
    .unwrap();
    assert_eq!(normalized.command.as_deref(), Some("/tmp/a.txt"));
}

#[test]
fn normalize_claude_ignores_unrelated_control_request() {
    assert!(normalize_permission_request(
        "claude",
        &json!({
            "type": "control_request",
            "request": { "subtype": "initialize" },
        }),
    )
    .is_none());
}

fn agent_request(id: &str) -> NormalizedPermissionRequest {
    normalize_permission_request(
        "agent",
        &json!({ "type": "permission_request", "permissionID": id, "tool": "bash" }),
    )
    .unwrap()
}

#[test]
fn build_response_agent_maps_decisions_verbatim() {
    let request = agent_request("perm-1");
    for decision in ["once", "always", "reject"] {
        let frame = build_permission_response("agent", &request, decision).unwrap();
        assert_eq!(
            frame,
            json!({
                "type": "permission_response",
                "permissionID": "perm-1",
                "response": decision,
            })
        );
    }
}

fn claude_request(id: &str, command: &str) -> NormalizedPermissionRequest {
    normalize_permission_request(
        "claude",
        &json!({
            "type": "control_request",
            "request_id": id,
            "request": {
                "subtype": "can_use_tool",
                "tool_name": "Bash",
                "input": { "command": command },
            },
        }),
    )
    .unwrap()
}

#[test]
fn build_response_claude_reject_denies() {
    let request = claude_request("req-1", "x");
    let frame = build_permission_response("claude", &request, "reject").unwrap();
    assert_eq!(frame["type"], "control_response");
    assert_eq!(frame["response"]["subtype"], "success");
    assert_eq!(frame["response"]["request_id"], "req-1");
    assert_eq!(frame["response"]["response"]["behavior"], "deny");
}

#[test]
fn build_response_claude_once_always_allow_with_input() {
    let request = claude_request("req-2", "npm test");
    for decision in ["once", "always"] {
        let frame = build_permission_response("claude", &request, decision).unwrap();
        assert_eq!(frame["response"]["response"]["behavior"], "allow");
        assert_eq!(
            frame["response"]["response"]["updatedInput"],
            json!({ "command": "npm test" })
        );
    }
}

#[test]
fn build_response_rejects_invalid_decision() {
    let request = agent_request("x");
    let err = build_permission_response("agent", &request, "maybe").unwrap_err();
    assert!(err.contains("Invalid permission decision"));
}

#[test]
fn build_response_rejects_unsupported_tool() {
    let request = agent_request("x");
    let err = build_permission_response("codex", &request, "once").unwrap_err();
    assert!(err.contains("does not support enforceable per-command approval"));
}

#[test]
fn permission_parity_covers_all_six_tools_with_scope_and_relay() {
    let parity = permission_parity();
    let mut tools: Vec<&str> = parity.iter().map(|row| row.tool).collect();
    tools.sort_unstable();
    assert_eq!(
        tools,
        vec!["agent", "claude", "codex", "gemini", "opencode", "qwen"]
    );
    for row in &parity {
        assert!(!row.native_mechanism.is_empty());
        assert!(!row.scope.is_empty());
        assert!(!row.notes.is_empty());
    }
    let mut relayable: Vec<&str> = parity
        .iter()
        .filter(|row| row.relay)
        .map(|row| row.tool)
        .collect();
    relayable.sort_unstable();
    assert_eq!(relayable, vec!["agent", "claude"]);
}

#[test]
fn relay_relays_an_agent_request_and_writes_the_response() {
    let mut written: Vec<String> = Vec::new();
    let decision;
    {
        let mut relay = PermissionRelay::new(
            "agent",
            |request: &NormalizedPermissionRequest| {
                assert_eq!(request.id.as_deref(), Some("perm-1"));
                assert_eq!(request.command.as_deref(), Some("rm -rf build"));
                "always".to_string()
            },
            |line: &str| written.push(line.to_string()),
        );

        let (_, applied) = relay
            .handle_message(&json!({
                "type": "permission_request",
                "permissionID": "perm-1",
                "tool": "bash",
                "metadata": { "command": "rm -rf build" },
            }))
            .unwrap();
        decision = applied;
        assert_eq!(relay.get_handled().len(), 1);
    }

    assert_eq!(decision, "always");
    assert_eq!(written.len(), 1);
    let frame: serde_json::Value = serde_json::from_str(&written[0]).unwrap();
    assert_eq!(
        frame,
        json!({
            "type": "permission_response",
            "permissionID": "perm-1",
            "response": "always",
        })
    );
}

#[test]
fn relay_ignores_non_permission_messages() {
    let mut written: Vec<String> = Vec::new();
    {
        let mut relay = PermissionRelay::new(
            "agent",
            |_: &NormalizedPermissionRequest| "once".to_string(),
            |line: &str| written.push(line.to_string()),
        );
        let result = relay.handle_message(&json!({ "type": "step_finish" }));
        assert!(result.is_none());
    }
    assert_eq!(written.len(), 0);
}

#[test]
fn relay_defaults_invalid_consumer_decision_to_reject() {
    let mut written: Vec<String> = Vec::new();
    let decision;
    {
        let mut relay = PermissionRelay::new(
            "claude",
            |_: &NormalizedPermissionRequest| "banana".to_string(),
            |line: &str| written.push(line.to_string()),
        );
        let (_, applied) = relay
            .handle_message(&json!({
                "type": "control_request",
                "request_id": "req-1",
                "request": { "subtype": "can_use_tool", "tool_name": "Bash", "input": { "command": "x" } },
            }))
            .unwrap();
        decision = applied;
    }
    assert_eq!(decision, "reject");
    let frame: serde_json::Value = serde_json::from_str(&written[0]).unwrap();
    assert_eq!(frame["response"]["response"]["behavior"], "deny");
}

#[test]
fn relay_claude_allow_forwards_updated_input() {
    let mut written: Vec<String> = Vec::new();
    {
        let mut relay = PermissionRelay::new(
            "claude",
            |_: &NormalizedPermissionRequest| "once".to_string(),
            |line: &str| written.push(line.to_string()),
        );
        relay
            .handle_message(&json!({
                "type": "control_request",
                "request_id": "req-2",
                "request": {
                    "subtype": "can_use_tool",
                    "tool_name": "Bash",
                    "input": { "command": "npm test" },
                },
            }))
            .unwrap();
    }
    let frame: serde_json::Value = serde_json::from_str(&written[0]).unwrap();
    assert_eq!(frame["response"]["response"]["behavior"], "allow");
    assert_eq!(
        frame["response"]["response"]["updatedInput"],
        json!({ "command": "npm test" })
    );
}
