//! Tests for Agent controller

use agent_commander::{agent, AgentOptions};

#[test]
fn test_agent_throws_without_tool() {
    let options = AgentOptions {
        working_directory: "/tmp/test".to_string(),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_err());
    if let Err(e) = result {
        assert!(e.contains("tool is required"));
    }
}

#[test]
fn test_agent_throws_without_working_directory() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_err());
    if let Err(e) = result {
        assert!(e.contains("working_directory is required"));
    }
}

#[test]
fn test_agent_throws_for_screen_without_name() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "screen".to_string(),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_err());
    if let Err(e) = result {
        assert!(e.contains("screen_name is required"));
    }
}

#[test]
fn test_agent_throws_for_docker_without_name() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "docker".to_string(),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_err());
    if let Err(e) = result {
        assert!(e.contains("container_name is required"));
    }
}

#[test]
fn test_agent_creates_with_valid_options() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "none".to_string(),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_ok());
}

#[test]
fn test_agent_creates_with_screen_isolation() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "screen".to_string(),
        screen_name: Some("test-screen".to_string()),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_ok());
}

#[test]
fn test_agent_creates_with_docker_isolation() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "docker".to_string(),
        container_name: Some("test-container".to_string()),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_ok());
}

#[test]
fn test_agent_creates_with_all_options() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "none".to_string(),
        prompt: Some("Hello".to_string()),
        system_prompt: Some("You are helpful".to_string()),
        model: Some("sonnet".to_string()),
        json: true,
        resume: Some("session-123".to_string()),
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_ok());
}

#[test]
fn test_agent_creates_with_empty_isolation() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        // isolation defaults to empty string
        ..Default::default()
    };
    let result = agent(options);
    assert!(result.is_ok());
}

#[test]
fn test_agent_options_default() {
    let options = AgentOptions::default();
    assert!(options.tool.is_empty());
    assert!(options.working_directory.is_empty());
    assert!(options.isolation.is_empty());
    assert!(!options.json);
    assert!(options.prompt.is_none());
    assert!(options.model.is_none());
}
