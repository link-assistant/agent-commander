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
- `--approve-each` (alias `--permission-mode ask`): approve each command, relaying native permission prompts as normalized NDJSON (supported for `agent` and `claude`)
- `--tool-executable <path>`: override the native executable for any supported tool
- `--tool-env <KEY=VALUE>`: add an environment variable to the native tool process, repeatable
- `--tool-arg <arg>`: append a raw native tool argument, repeatable
- `--skip-default-safety-flags`: suppress default autonomous safety bypass flags, including Qwen/Gemini `--yolo`
- `--reasoning-effort <level>`: native reasoning effort (claude `--effort`, codex `model_reasoning_effort`, opencode `--variant`)
- `--mcp-config <path|json>` and `--strict-mcp-config`: MCP servers (claude, codex, qwen; strict for claude)
- `--add-dir <dir>`: extra directory the agent may access, repeatable (claude, codex, gemini, qwen)
- `--attach <file>`: attach a file to the prompt, repeatable (codex `--image`, opencode `--file`)
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

`result.metadata` is a normalized summary for all six supported tools. It includes success and error classification, session ID, usage-limit reset details, result summary, cost estimates, stream token usage, optional model usage, and sub-agent call summaries. `result.usage` exposes the aggregated stream token usage as JSON for parity with the JavaScript package.

For large generated prompts, set `prompt_file` or let the controller create a temporary prompt file automatically for `claude`, `codex`, `opencode`, `agent`, `qwen`, and `gemini`.

For parity with fast-moving native CLIs, set raw executable, environment, and argument overrides for any supported tool on `AgentOptions`:

```rust
let mut controller = agent(AgentOptions {
    tool: "claude".to_string(),
    working_directory: "/tmp/project".to_string(),
    prompt_file: Some("/tmp/agent-prompt.txt".to_string()),
    executable: Some("/opt/claude-code/bin/claude".to_string()),
    extra_env: vec![("MCP_TIMEOUT".to_string(), "10000".to_string())],
    // Inherited variables removed from the tool's environment
    unset_env: vec!["ANTHROPIC_API_KEY".to_string()],
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

## Completion, usage and cancellation

For direct JSON runs, `metadata.success` requires native completion and a successful process exit. Empty or unfinished streams return `incomplete_stream`; Agent's default NDJSON mode uses the same check. Protocol parsing and usage use stdout, while `plain_output` retains stderr diagnostics. Parent session metadata excludes Claude subagent-scoped results.

`stop()` waits for a direct process to finish. `AgentStopOptions { close_timeout, background_wait, .. }` ends a process that stays alive after its final result (the Claude print-mode hang, hive-mind#1280), allowing `background_wait` more while the result reports running background tasks. Such a run keeps `success` with `terminated_after_result`. `controller.cancel().await?` interrupts it and collects the final result. Unix cancellation signals the process group; Windows cancellation signals the immediate child. A native CLI that ignores SIGTERM needs a caller-managed termination policy. Process pipes drain concurrently from start, including when attached output is disabled. Set `AGENT_COMMANDER_DEBUG=1` for cancellation diagnostics.

When a failed Codex or Claude run did not print its usage limit, `stop()` reads the last turn of the Codex rollout or the last entry of the Claude transcript and sets `limit_source` to `codex-rollout` or `claude-transcript` (hive-mind#3570). A `CODEX_HOME` or `CLAUDE_CONFIG_DIR` in `extra_env` is honoured. The checks are public: `apply_codex_rollout_usage_limit`, `detect_codex_rollout_usage_limit`, `can_resume_codex_session` (hive-mind#2888), `apply_claude_transcript_usage_limit` and `read_claude_transcript_api_error`, with `CodexRolloutOptions` and `ClaudeTranscriptOptions`. `detect_usage_limit_sources` and `is_recoverable_tool_error` are Hive Mind's classifiers.

Usage preserves native final totals without adding repeated assistant snapshots. Codex `input_tokens` now counts fresh input; add `cache_read_tokens` to recover inclusive input. Serializable usage structs expose cache and reasoning fields, and Qwen/Gemini results now include `usage` too.

Bundled aliases track a recorded Hive Mind catalogue (v2.39.5: `sonnet` is `claude-sonnet-5-5`, `opus` is `claude-opus-5-5`); exact model IDs pass through for caller-managed live discovery. Omitting `model` leaves selection to the native CLI. Claude's `opus` execution alias stays rolling. Common `resume` works for all six tools; Agent adds `--no-fork`, and OpenCode uses `--session`.

See the [parity audit](../docs/case-studies/issue-50/README.md) for the feature matrix and regression evidence.

## Launch options, live input and run telemetry

```rust
use agent_commander::{agent, get_tool_version, AgentOptions, AgentStartOptions, AgentStopOptions, LaunchOptions};

# async fn run() -> Result<(), String> {
let probe = get_tool_version("claude", None, Some("2.0.0")).await.map_err(|e| e.to_string())?;
assert_eq!(probe.meets_minimum, Some(true));

let mut controller = agent(AgentOptions {
    tool: "claude".to_string(),
    working_directory: "/tmp/project".to_string(),
    prompt: Some("Refactor the parser".to_string()),
    launch: LaunchOptions {
        reasoning_effort: Some("high".to_string()),
        mcp_config: Some("/tmp/mcp.json".to_string()),
        strict_mcp_config: true,
        additional_directories: vec!["../shared".to_string()],
        ..Default::default()
    },
    live_input: true,
    ..Default::default()
})?;
controller.start(AgentStartOptions::default()).await?;
controller.send_message("Keep the public API unchanged").await?;
let result = controller.stop(AgentStopOptions::default()).await?;
println!("{:?} {:?}", result.metadata.usage_windows, result.metadata.context_usage);
# Ok(())
# }
```

A tool without a native flag for a launch option is rejected before it starts; `launch_capabilities(tool)` reports what each tool supports. `attachments` works for Codex (`--image`) and OpenCode (`--file`). `interrupt().await` ends the running turn for Claude and Qwen; `end_input()` closes stdin. `metadata.usage_windows` comes from Claude `rate_limit_event` messages and Codex `rate_limits`; `metadata.context_usage` reports the last and peak context fill against the model's window. For Codex, `stop()` reads both from the thread's rollout file. See [launch options](../docs/common-concepts.md#launch-options) and the [upcomputer case study](../docs/case-studies/issue-57/README.md).

## Shared Behavior

JavaScript and Rust expose the same core concepts:

- Tool selection and model alias mapping
- `none`, `screen`, and `docker` isolation modes
- Dry-run command preview
- JSON/NDJSON output parsing for tools that support it
- Read-only planning mode for tools with enforceable native restrictions
- Per-command approval (ask mode) with a normalized `permission_request`/`permission_response` relay for tools with a drivable native handshake
- Launch options, live input, usage windows, context usage and the tool version probe

See [shared concepts](../docs/common-concepts.md) for behavior that should stay aligned across both packages, including the [per-command approval parity table](../docs/common-concepts.md#per-command-approval-ask-mode).

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

## Interactive Terminal Capture

Use `tui::capture_agent_tui` when a test needs the client's real terminal
interface rather than its headless JSON mode. The capture drives text, control
keys, and resizes through a PTY, then returns an unrolled transcript, normalized
message/tool-call events, settled frames, and asciicast-compatible replay data.
When `artifact_directory` is set it also writes a transcript, frame data, a
static snapshot, a cast, and an animated SVG suitable for CI artifacts.
`frames_on_write: true` records a frame after every PTY write instead of after
each settle, and `recording: false` keeps only the latest frame and the last
1 MB of output for long sessions (command-stream 1.9.0).

```rust,no_run
use agent_commander::tui::{capture_agent_tui, AgentTuiOptions};

let capture = capture_agent_tui(AgentTuiOptions {
    tool: "codex".into(),
    working_directory: std::env::current_dir()?,
    prompt: Some("Summarize this repository".into()),
    artifact_directory: Some("artifacts/codex".into()),
    ..AgentTuiOptions::default()
})?;
println!("{}", capture.terminal.transcript);
# Ok::<(), Box<dyn std::error::Error>>(())
```
