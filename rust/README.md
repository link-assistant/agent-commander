# agent-commander

[![crates.io version](https://img.shields.io/crates/v/agent-commander?label=crates.io&style=flat)](https://crates.io/crates/agent-commander)
[![Rust CI/CD](https://github.com/link-assistant/agent-commander/actions/workflows/rust.yml/badge.svg)](https://github.com/link-assistant/agent-commander/actions/workflows/rust.yml)

Rust bindings and CLI tools for controlling AI coding agents through their native command-line interfaces.

This crate provides the same core behavior as the JavaScript package: command building, process control, isolation wrappers, JSON streaming helpers, model aliasing, and read-only planning mode.

## Install

```bash
cargo add agent-commander
```

Install the CLI binaries:

```bash
cargo install agent-commander
```

## CLI

```bash
start-agent --tool claude --working-directory "/tmp/project" --prompt "Inspect this project"
```

```bash
start-agent --tool claude --working-directory "/tmp/project" \
  --prompt "Plan the change" --read-only --model opus --fallback-model sonnet
```

```bash
start-agent --tool codex --working-directory "/tmp/project" \
  --prompt "Run a focused review" --isolation screen --screen-name review-agent --detached
```

Common options:

- `--tool <name>`: `claude`, `codex`, `opencode`, `qwen`, `gemini`, or `agent`
- `--working-directory <path>`: directory where the agent command runs
- `--prompt <text>` and `--system-prompt <text>`: user and system prompts
- `--prompt-file <path>`: read prompt input from a file for stdin-based tools
- `--model <name>`: tool-specific model alias or full model name
- `--read-only` or `--plan-only`: enforce native planning/no-write mode when supported
- `--tool-executable <path>`: override the native executable for any supported tool
- `--tool-env <KEY=VALUE>`: add an environment variable to the native tool process, repeatable
- `--tool-arg <arg>`: append a raw native tool argument, repeatable
- `--skip-default-safety-flags`: suppress default autonomous safety bypass flags, including Qwen/Gemini `--yolo`
- `--isolation <mode>`: `none`, `screen`, or `docker`
- `--dry-run`: print the command without executing it

Claude-specific options include `--append-system-prompt`, `--fallback-model`, `--session-id`, `--fork-session`, `--verbose`, and `--replay-user-messages`.

## Library

```rust
use agent_commander::{agent, AgentOptions, AgentStartOptions, AgentStopOptions};

#[tokio::main]
async fn main() -> Result<(), String> {
    let mut controller = agent(AgentOptions {
        tool: "claude".to_string(),
        working_directory: "/tmp/project".to_string(),
        prompt: Some("Return a short implementation plan".to_string()),
        model: Some("sonnet".to_string()),
        read_only: true,
        isolation: "none".to_string(),
        ..Default::default()
    })?;

    controller
        .start(AgentStartOptions {
            attached: false,
            ..Default::default()
        })
        .await?;

    let result = controller.stop(AgentStopOptions::default()).await?;
    println!("{}", result.plain_output);
    println!("{:?}", result.metadata);
    Ok(())
}
```

`result.metadata` is a normalized summary for `claude`, `codex`, `opencode`, and `agent` runs. It includes success and error classification, session ID, usage-limit reset details, result summary, cost estimates, stream token usage, optional model usage, and sub-agent call summaries. `result.usage` exposes the aggregated stream token usage as JSON for parity with the JavaScript package.

For large generated prompts, set `prompt_file` or let the controller create a temporary prompt file automatically for `claude`, `codex`, `opencode`, `agent`, `qwen`, and `gemini`.

For parity with fast-moving native CLIs, set raw executable, environment, and argument overrides for any supported tool on `AgentOptions`:

```rust
let mut controller = agent(AgentOptions {
    tool: "claude".to_string(),
    working_directory: "/tmp/project".to_string(),
    prompt_file: Some("/tmp/agent-prompt.txt".to_string()),
    executable: Some("/opt/claude-code/bin/claude".to_string()),
    extra_env: vec![("MCP_TIMEOUT".to_string(), "10000".to_string())],
    extra_args: vec![
        "--mcp-config".to_string(),
        "/tmp/mcp.json".to_string(),
        "--permission-mode".to_string(),
        "default".to_string(),
    ],
    skip_default_safety_flags: true,
    ..Default::default()
})?;
```

## Shared Behavior

JavaScript and Rust expose the same core concepts:

- Tool selection and model alias mapping
- `none`, `screen`, and `docker` isolation modes
- Dry-run command preview
- JSON/NDJSON output parsing for tools that support it
- Read-only planning mode for tools with enforceable native restrictions

See [shared concepts](../docs/common-concepts.md) for behavior that should stay aligned across both packages.

## Release Flow

Rust releases use changelog fragments in `rust/changelog.d/`:

```markdown
---
bump: patch
---

### Fixed

- Describe the user-facing fix.
```

The GitHub Release workflow publishes language-specific releases with `rust_` tags and `[Rust] vX.Y.Z` release names.

## Test

```bash
cargo fmt --all -- --check
cargo clippy --all-targets --all-features
cargo test --all-features
```
