//! Tests for Agent controller

use agent_commander::{agent, AgentOptions, AgentStartOptions, AgentStopOptions};

#[cfg(not(target_os = "windows"))]
struct PathGuard {
    previous_path: String,
    temp_dir: std::path::PathBuf,
}

#[cfg(not(target_os = "windows"))]
impl Drop for PathGuard {
    fn drop(&mut self) {
        std::env::set_var("PATH", &self.previous_path);
        let _ = std::fs::remove_dir_all(&self.temp_dir);
    }
}

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
        append_system_prompt: Some("Extra instructions".to_string()),
        model: Some("sonnet".to_string()),
        fallback_model: Some("haiku".to_string()),
        json: true,
        resume: Some("session-123".to_string()),
        verbose: true,
        replay_user_messages: true,
        session_id: Some("123e4567-e89b-12d3-a456-426614174000".to_string()),
        fork_session: true,
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
    assert!(options.prompt_file.is_none());
    assert!(options.model.is_none());
    assert!(options.fallback_model.is_none());
    assert!(!options.verbose);
    assert!(!options.replay_user_messages);
    assert!(options.session_id.is_none());
    assert!(!options.fork_session);
}

#[tokio::test]
async fn test_agent_start_in_dry_run_mode() {
    let options = AgentOptions {
        tool: "echo".to_string(),
        working_directory: "/tmp/test".to_string(),
        prompt: Some("Hello".to_string()),
        isolation: "none".to_string(),
        ..Default::default()
    };
    let mut controller = agent(options).unwrap();

    let result = controller
        .start(AgentStartOptions {
            dry_run: true,
            ..Default::default()
        })
        .await;

    assert!(result.is_ok());
}

#[tokio::test]
async fn test_agent_stop_throws_for_no_isolation_without_start() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "none".to_string(),
        ..Default::default()
    };
    let mut controller = agent(options).unwrap();

    let result = controller.stop(AgentStopOptions::default()).await;

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("Agent not started"));
}

#[tokio::test]
async fn test_agent_stop_in_dry_run_mode_with_screen() {
    let options = AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/test".to_string(),
        isolation: "screen".to_string(),
        screen_name: Some("test-session".to_string()),
        ..Default::default()
    };
    let mut controller = agent(options).unwrap();

    let result = controller
        .stop(AgentStopOptions { dry_run: true })
        .await
        .unwrap();

    assert_eq!(result.exit_code, 0);
    assert!(result.plain_output.is_empty());
    assert!(result.parsed_output.is_none());
}

#[tokio::test]
#[cfg(not(target_os = "windows"))]
async fn test_agent_start_and_stop_with_no_isolation() {
    let options = AgentOptions {
        tool: "echo".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some("Hello World".to_string()),
        isolation: "none".to_string(),
        ..Default::default()
    };
    let mut controller = agent(options).unwrap();

    controller
        .start(AgentStartOptions {
            attached: false,
            ..Default::default()
        })
        .await
        .unwrap();
    let result = controller.stop(AgentStopOptions::default()).await.unwrap();

    assert_eq!(result.exit_code, 0);
    assert!(result.plain_output.contains("Hello World"));
}

#[tokio::test]
#[cfg(not(target_os = "windows"))]
async fn test_agent_stdin_tools_handle_large_shell_sensitive_prompts_through_file() {
    let temp_dir = std::env::temp_dir().join(format!(
        "agent-commander-test-bin-{}-{}",
        std::process::id(),
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    std::fs::create_dir_all(&temp_dir).unwrap();
    let fake_agent = temp_dir.join("agent");
    std::fs::write(
        &fake_agent,
        "#!/usr/bin/env bash\nwc -c | tr -d \"[:space:]\"\n",
    )
    .unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut permissions = std::fs::metadata(&fake_agent).unwrap().permissions();
        permissions.set_mode(0o755);
        std::fs::set_permissions(&fake_agent, permissions).unwrap();
    }

    let previous_path = std::env::var("PATH").unwrap_or_default();
    std::env::set_var("PATH", format!("{}:{}", temp_dir.display(), previous_path));
    let _path_guard = PathGuard {
        previous_path,
        temp_dir,
    };

    let prompt = format!("{}\n' \"$HOME\" `pwd`", "x".repeat(3 * 1024 * 1024));
    let system_prompt = "system instructions".to_string();
    let expected_bytes = format!("{}\n\n{}", system_prompt, prompt).len();
    let options = AgentOptions {
        tool: "agent".to_string(),
        working_directory: "/tmp".to_string(),
        prompt: Some(prompt),
        system_prompt: Some(system_prompt),
        isolation: "none".to_string(),
        ..Default::default()
    };
    let mut controller = agent(options).unwrap();

    controller
        .start(AgentStartOptions {
            attached: false,
            ..Default::default()
        })
        .await
        .unwrap();
    let result = controller.stop(AgentStopOptions::default()).await.unwrap();

    assert_eq!(result.exit_code, 0);
    assert_eq!(result.plain_output.trim(), expected_bytes.to_string());
}
