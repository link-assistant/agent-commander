# Terminal capture: no way to choose which artifacts are written (GIF always rendered in JS)

> Filed as https://github.com/link-foundation/command-stream/issues/231 (issue #55 of agent-commander).

## Summary

`captureTerminal({ artifactDirectory })` (JS 2.4.0) always renders and writes every artifact: `transcript.txt`, `frames.json`, `session.cast`, `snapshot.svg`, `recording.svg` and `recording.gif` (`js/src/terminal-artifacts.mjs:493-530`). The GIF step (resvg rasterisation + gifenc, `:424-469`) is by far the most expensive one. The Rust `write_terminal_artifacts` (`rust/src/terminal/artifacts.rs:174`) likewise always writes its five files. Neither side has an `artifacts` / `formats` option. The 1.9.0 / 2.4.0 `recording: false` flag skips the recording work but does not select files.

## Why it matters

[agent-commander](https://github.com/link-assistant/agent-commander) exposes `captureAgentTui({ artifacts: ['transcript', 'snapshot'] })` for CI runs that only need a transcript. Today it captures everything and then deletes the unrequested files (`selectArtifacts` in `js/src/tui.mjs`), which still pays for the GIF render on every capture.

## Suggested API

```js
await captureTerminal({ ..., artifactDirectory, artifacts: ['transcript', 'snapshot'] });
```

```rust
TerminalCaptureOptions { artifacts: Some(vec![TerminalArtifact::Transcript, TerminalArtifact::Snapshot]), .. }
```

The option should default to all artifacts, for backward compatibility. Each renderer should be skipped when its artifact is not requested.

## Related parity gaps (Rust vs JS)

The Rust `TerminalCaptureOptions` has no `aspect_ratio` (JS `aspectRatio`, which makes the JS default rows 30 for 80 columns vs Rust 24), no `on_trace` callback (JS `onTrace`), and no `recording.gif`.

Found while syncing agent-commander with Hive Mind 2.39.5 (link-assistant/agent-commander#55).
