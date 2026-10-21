# Rust: no way to remove a single inherited environment variable (`StreamingRunner`, `RunOptions`, `TerminalCaptureOptions`)

> Filed as https://github.com/link-foundation/command-stream/issues/229 (issue #55 of agent-commander).

## Summary

The Rust crate (1.9.0) can only **add** environment variables to a child process, or clear the whole inherited environment. There is no per-variable removal (the `std::process::Command::env_remove` / `env -u NAME` equivalent):

| API | Add | Clear all | Remove one |
| --- | --- | --- | --- |
| `StreamingRunner` (`src/stream.rs:156` `env`, `:180` `clear_env`) | yes | yes | **no** |
| `RunOptions.env` (`src/run_options.rs:82`) | yes | no | **no** |
| `terminal::TerminalCaptureOptions.env` (`src/terminal/types.rs:61`, applied in `src/terminal/capture.rs:346-355` with `CommandBuilder::env`) | yes | **no** | **no** |

For `StreamingRunner` a caller can work around this by calling `clear_env(true)` and passing the full parent environment minus the unwanted keys. `TerminalCaptureOptions` has no clear option, so a PTY child **always** inherits every parent variable. `portable_pty::CommandBuilder` has `env_remove` and `env_clear`, so the capability is already available in the dependency.

## Why it matters

Agent CLIs change behaviour based on inherited variables. For example, an inherited `ANTHROPIC_API_KEY` switches `claude` from subscription to API billing, and `CLAUDECODE`, `CODEX_HOME` and `OPENCODE_*` change session and nesting behaviour. Orchestrators such as [Hive Mind](https://github.com/link-assistant/hive-mind) and [agent-commander](https://github.com/link-assistant/agent-commander) need to launch a child with *"the parent env, minus these names"*. The JS side can already do this by passing a spread of `process.env` with keys deleted.

## Reproduction

```rust
use command_stream::terminal::{capture_terminal, TerminalCaptureOptions};
use std::collections::HashMap;

std::env::set_var("SECRET_TOKEN", "leaked");
let capture = capture_terminal(TerminalCaptureOptions {
    file: "sh".into(),
    args: vec!["-c".into(), "echo token=${SECRET_TOKEN:-unset}".into()],
    env: HashMap::new(), // no way to express "remove SECRET_TOKEN"
    ..TerminalCaptureOptions::default()
})?;
assert!(capture.transcript.contains("token=leaked")); // cannot be prevented
```

## Suggested API

- `StreamingRunner::env_remove(name)` / `.env_remove_all(names)`.
- `RunOptions.env_remove: Vec<String>` (or `env_unset`).
- `TerminalCaptureOptions.env_remove: Vec<String>` and `env_clear: bool`, forwarded to `portable_pty::CommandBuilder::env_remove` / `env_clear`.
- On the JS side, document that `env` replaces the environment (it already does for `captureTerminal`) or accept `undefined` values as "remove", for symmetry.

## Current workaround in agent-commander

The launch is wrapped in `env -u NAME ... <tool> <args>`: see `rust/src/tui.rs` (`unset_env`) and the `unset_env` / `unsetEnv` option of the command builders. This needs an `env` binary on PATH, and it moves `argv[0]` of the PTY child to `env`.

Found while syncing agent-commander with Hive Mind 2.39.5 (link-assistant/agent-commander#55).
