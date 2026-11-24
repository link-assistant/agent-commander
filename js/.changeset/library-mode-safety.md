---
'agent-commander': minor
---

Library-mode safety (issues #59, #60):

- `agent({ handleSignals: false })` and `start({ signalHandlers: false })` skip the SIGINT/SIGTERM handler, so a host service owns shutdown and calls `cancel()`. When the handler is on, concurrent runs share one listener per signal, and after cleanup the signal is handed back to the host: if the host listens for it, the host decides; otherwise the signal is re-raised so the process ends with 128 + N instead of `process.exit(0)`.
- `toolOptions.extraEnv` values reach the child through the `spawn` environment and are no longer rendered as `env KEY=value` on the `bash -c` command line (docker isolation forwards them with `-e NAME`). New `toolOptions.env` (explicit replacement map) and `toolOptions.inheritEnv` (`true`, `false` or an allowlist of names) restrict what the child inherits; `buildChildEnvironment()` is exported.
- Claude `systemPrompt` / `appendSystemPrompt` are written to 0600 temp files and passed as `--system-prompt-file` / `--append-system-prompt-file` (also in the Claude TUI capture). The `jsonSchema` of claude, qwen and codex is written to a temp file too (`--output-schema <file>` for codex).
