//! Read-only, planning and per-command approval modes of the agent command
//! builder.

use agent_commander::{build_agent_command, AgentCommandOptions};

#[test]
fn test_build_agent_command_claude_read_only() {
    let options = AgentCommandOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Plan only".to_string()),
        read_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("--permission-mode"));
    assert!(command.contains("plan"));
    assert!(!command.contains("--dangerously-skip-permissions"));
}

#[test]
fn test_build_agent_command_codex_read_only() {
    let options = AgentCommandOptions {
        tool: "codex".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Plan only".to_string()),
        read_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("codex --ask-for-approval never exec"));
    assert!(command.contains("--sandbox"));
    assert!(command.contains("read-only"));
    assert!(!command.contains("--dangerously-bypass-approvals-and-sandbox"));
}

#[test]
fn test_build_agent_command_opencode_read_only() {
    let options = AgentCommandOptions {
        tool: "opencode".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Plan only".to_string()),
        read_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("OPENCODE_PERMISSION="));
    assert!(command.contains("bash"));
    assert!(command.contains("edit"));
    assert!(command.contains("deny"));
}

#[test]
fn test_build_agent_command_agent_read_only_uses_readonly_mode() {
    let options = AgentCommandOptions {
        tool: "agent".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Inspect only".to_string()),
        read_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("--permission-mode"));
    assert!(command.contains("readonly"));
    assert!(!command.contains("plan"));
}

#[test]
fn test_build_agent_command_agent_plan_only_uses_plan_mode() {
    let options = AgentCommandOptions {
        tool: "agent".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Plan only".to_string()),
        plan_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("--permission-mode"));
    assert!(command.contains("plan"));
    assert!(!command.contains("readonly"));
}

#[test]
fn test_build_agent_command_agent_approve_each_uses_ask_mode() {
    let options = AgentCommandOptions {
        tool: "agent".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Do work".to_string()),
        approve_each: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("--permission-mode"));
    assert!(command.contains("ask"));
    // Ask mode requires streaming stdin so requests can be answered mid-turn.
    assert!(command.contains("--input-format"));
    assert!(command.contains("stream-json"));
    assert!(!command.contains("readonly"));
}

#[test]
fn test_build_agent_command_claude_approve_each_uses_default_mode() {
    let options = AgentCommandOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Do work".to_string()),
        approve_each: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let command = build_agent_command(&options);
    assert!(command.contains("--permission-mode"));
    assert!(command.contains("default"));
    // Default mode keeps Claude's own per-tool prompting active instead of
    // bypassing it.
    assert!(!command.contains("--dangerously-skip-permissions"));
    assert!(!command.contains("plan"));
}

#[test]
#[should_panic(expected = "does not support enforceable per-command approval")]
fn test_build_agent_command_approve_each_rejects_codex() {
    let options = AgentCommandOptions {
        tool: "codex".to_string(),
        working_directory: "/tmp/test".to_string(),
        approve_each: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let _command = build_agent_command(&options);
}

#[test]
#[should_panic(expected = "does not support enforceable per-command approval")]
fn test_build_agent_command_approve_each_rejects_unknown_tool() {
    let options = AgentCommandOptions {
        tool: "unknown-tool".to_string(),
        working_directory: "/tmp/test".to_string(),
        approve_each: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let _command = build_agent_command(&options);
}

#[test]
#[should_panic(expected = "does not support enforceable read-only mode")]
fn test_build_agent_command_read_only_rejects_unknown_tool() {
    let options = AgentCommandOptions {
        tool: "unknown-tool".to_string(),
        working_directory: "/tmp/test".to_string(),
        read_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    };

    let _command = build_agent_command(&options);
}
