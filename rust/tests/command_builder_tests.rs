//! Generic tool commands quote the prompt so the shell passes it unchanged
//! (issue #55).
#![cfg(unix)]

use agent_commander::{build_agent_command, AgentCommandOptions};

#[test]
fn generic_tool_receives_prompts_with_shell_characters_unchanged() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    let tool = dir.path().join("print-args");
    std::fs::write(&tool, "#!/usr/bin/env bash\nprintf '%s\\n' \"$@\"\n").unwrap();
    std::fs::set_permissions(&tool, std::fs::Permissions::from_mode(0o755)).unwrap();

    let prompt = r#"Fix "$HOME" `id` it's \n done"#;
    let system_prompt = "Be $USER's helper";
    let command = build_agent_command(&AgentCommandOptions {
        tool: tool.display().to_string(),
        working_directory: dir.path().display().to_string(),
        prompt: Some(prompt.to_string()),
        system_prompt: Some(system_prompt.to_string()),
        isolation: "none".to_string(),
        ..Default::default()
    });
    let output = std::process::Command::new("sh")
        .arg("-c")
        .arg(&command)
        .output()
        .unwrap();
    assert!(output.status.success(), "{command}: {output:?}");
    assert_eq!(
        String::from_utf8_lossy(&output.stdout),
        format!("--prompt\n{prompt}\n--system-prompt\n{system_prompt}\n"),
        "{command}"
    );
}
