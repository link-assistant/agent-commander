# CI Summary

CI was already failing on the prepared branch before the read-only work. The logs were downloaded locally to `ci-logs/` for investigation:

| Run ID | Created | Head SHA | Conclusion | Log file |
|--------|---------|----------|------------|----------|
| 24962674421 | 2026-04-26 17:28 UTC | 7d292fd | failure | `ci-logs/run-24962674421.log` |
| 24962672246 | 2026-04-26 17:28 UTC | 7d292fd | failure | `ci-logs/run-24962672246.log` |

## Root Cause

The Deno test jobs dynamically imported `https://esm.sh/command-stream@latest` through `js/src/utils/loader.mjs`. The CDN returned HTTP 500, so Deno failed before the actual tests could run.

Evidence:

- `ci-logs/run-24962674421.log:3793`: Deno downloaded `https://esm.sh/command-stream@latest`.
- `ci-logs/run-24962674421.log:3903`: failed to import that module.
- `ci-logs/run-24962674421.log:3913`: underlying error was `500 Internal Server Error`.
- `ci-logs/run-24962672246.log:6066`: Ubuntu Deno downloaded the same module.
- `ci-logs/run-24962672246.log:6176`: failed to import that module.
- `ci-logs/run-24962672246.log:6186`: underlying error was `500 Internal Server Error`.
- `ci-logs/run-24962672246.log:10301`: macOS Deno downloaded the same module.
- `ci-logs/run-24962672246.log:10411`: failed to import that module.
- `ci-logs/run-24962672246.log:10421`: underlying error was `500 Internal Server Error`.

## Fix Direction

Remove the runtime dependency on the CDN-backed `command-stream` module for command execution. `js/src/executor.mjs` now uses the Node-compatible `child_process.spawn` API, which Deno supports in npm/node compatibility mode, and keeps the existing `executeCommand`, `startCommand`, and `executeDetached` surfaces.

