//! Per-run tool overrides (issue #57): add a flag the built-in Claude builder
//! lacks, without waiting for an agent-commander release.
//!
//! Run with: `cargo run --example tool_overrides` (prints the dry-run command).

use agent_commander::{
    agent, build_base_command, escape_arg, launch_capabilities, AgentCommandOptions, AgentOptions,
    AgentStartOptions, LaunchCapabilities, LaunchOptions, ToolOverrides,
};
use std::sync::Arc;

#[tokio::main]
async fn main() -> Result<(), String> {
    let mut controller = agent(AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/project".to_string(),
        prompt: Some("Describe the screenshot".to_string()),
        launch: LaunchOptions {
            attachments: vec!["shot.png".to_string()],
            ..Default::default()
        },
        tool_overrides: ToolOverrides {
            build_command: Some(Arc::new(|options: &AgentCommandOptions| {
                let mut inner = options.clone();
                let images = std::mem::take(&mut inner.launch.attachments);
                format!(
                    "{} --image {}",
                    build_base_command(&inner),
                    images
                        .iter()
                        .map(|image| escape_arg(image))
                        .collect::<Vec<_>>()
                        .join(" ")
                )
            })),
            launch_capabilities: Some(LaunchCapabilities {
                attachments: true,
                ..launch_capabilities("claude")
            }),
            ..Default::default()
        },
        ..Default::default()
    })?;
    controller
        .start(AgentStartOptions {
            dry_run: true,
            ..Default::default()
        })
        .await
}
