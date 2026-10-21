# Fire-and-forget detached spawn (JS + Rust): start a command that outlives the caller and get its pid

> Filed as https://github.com/link-foundation/command-stream/issues/232 (issue #55 of agent-commander).

## Summary

command-stream (JS 2.4.0, Rust 1.9.0, `main` at `6ccdc2da`) cannot start a background command that keeps running after the caller returns or exits:

| API                      | Why it is not fire-and-forget                                                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| JS `$` / `ProcessRunner` | The child is already spawned with `detached` off Windows, and `stdout`/`stderr` options reach `spawn` (`js/src/$.process-runner-execution.mjs:161-167`, `:912-915`). But stdin is always a pipe (`:166`), the child is never `unref()`'d and the runner keeps exit listeners, so the caller's event loop stays alive until the command ends. There is no option that resolves with the pid as soon as the process has started. |
| Rust `StreamingRunner`   | `spawn` sets `kill_on_drop(true)` (`rust/src/stream.rs:499`), so dropping the `OutputStream` kills the child.                                                                                                                                                                                                                                                                                                                  |
| Rust `ProcessRunner`     | `pid()` (`rust/src/lib.rs:270`) and `child()` (`:483`) exist, but stdout and stderr are piped or inherited, never null (`:400-405`), and the runner expects to be awaited.                                                                                                                                                                                                                                                     |

## Why it matters

[agent-commander](https://github.com/link-assistant/agent-commander) starts agents in the background (`--detached`, and the `screen`/`docker` launchers) and only needs the pid back. It keeps its own helpers for this:

- JS `executeDetached` (`js/src/executor.mjs:309`): `spawn('bash', ['-c', command], { detached: true, stdio: 'ignore' })`, then `child.unref()` and resolve with `{ pid }`.
- Rust `execute_detached` (`rust/src/executor.rs`): `bash -c` with null stdio and `process_group(0)`, returning `child.id()`.

While writing these we found a parity bug in our own Rust helper (the child stayed in the caller's process group, so Ctrl+C to the caller also stopped the agent). A shared upstream primitive would keep both languages aligned.

## Proposal

- JS: `$({ detached: true })` (or `spawnDetached(command, options)`) that spawns in a new session with `stdio: 'ignore'`, calls `unref()`, and resolves with `{ pid }` once the `spawn` event fires (rejects on `error`).
- Rust: `StreamingRunner::detach()` / `ProcessRunner::spawn_detached()` that spawns with null stdio, `process_group(0)` on Unix (`CREATE_NEW_PROCESS_GROUP | DETACHED_PROCESS` on Windows), no `kill_on_drop`, and returns `Option<u32>`.

Both should honour the usual `cwd` and `env` options, so callers do not need to wrap the command in `bash -c` themselves.

## Related

- #229 (Rust per-variable env removal) and #230 (Rust live stdin for argv streaming) are the other gaps that keep agent-commander's executors hand-rolled.
- Found while syncing agent-commander with Hive Mind v2.39.5 (link-assistant/agent-commander#55).
