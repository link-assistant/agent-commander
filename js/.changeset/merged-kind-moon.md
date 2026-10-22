---
'agent-commander': minor
---

Sync with Hive Mind v2.39.5 (issue #55). Port Hive Mind's usage-limit and agent error classification: `limitResetsAt` and `limitWindow`; server throttles reported as the `rate_limited` error type; recoverable agent tool errors. When a failed Codex or Claude run did not report a usage limit in its output, the limit is now read from the Codex rollout or the Claude transcript, and `limitSource` says which (`canResumeCodexSession`, `applyCodexRolloutUsageLimit`, `applyClaudeTranscriptUsageLimit`). Exits are signal-aware and kill the whole process group. `stop({ closeTimeoutMs, backgroundWaitMs })` closes a process that lingers after its result. New metadata: background tasks, observed models and Claude API error details. `extraEnv` values of `null` unset inherited variables. Rolling Claude aliases are kept, and model aliases match case-insensitively. Pretty-printed and concatenated JSON records are parsed, and a failed run's error comes from a JSON error record on stderr when stdout has none (Agent prints its fatal errors there). `captureAgentTui` forwards command-stream 2.4's `frameMode` and `recording` options, and command quoting uses command-stream's `quoteForContext`. The model catalogue is synced, and the dev dependencies move to their latest majors. The rollout and transcript checks read the home directory only when `CODEX_HOME` or `CLAUDE_CONFIG_DIR` does not already say where to look, and fall back to `HOME` when Deno denies `os.homedir()`.

Agent-control features that upcomputer and Hive Mind need (issue #57). New launch options, each mapped to the tool's native flag and rejected by tools without one:

- `reasoningEffort`: Claude `--effort`, Codex `model_reasoning_effort`, OpenCode `--variant`.
- `mcpConfig` and `strictMcpConfig`: Claude and Qwen `--mcp-config`, Codex `-c mcp_servers={…}`.
- `additionalDirectories`: `--add-dir` / `--include-directories`.
- `attachments`: Codex `--image`, OpenCode `--file`.
- `jsonSchema`: Claude and Qwen `--json-schema`, Codex `--output-schema`.

The matching CLI flags are `--reasoning-effort`, `--mcp-config`, `--strict-mcp-config`, `--add-dir`, `--attach` and `--json-schema`.

New result metadata:

- `usageWindows`: session, weekly and other subscription windows from Claude `rate_limit_event` and Codex `rate_limits`, or from the Codex rollout.
- `contextUsage`: the context-window gauge.
- `structuredOutput`: the schema-shaped answer.

`liveInput: true` keeps stdin open for claude, qwen and agent, so `sendMessage(text, { images })`, `interrupt()` and `endInput()` can steer a running turn. `getToolVersion`, `parseToolVersion` and `compareVersions` probe CLI versions.

Per-run `toolOverrides` replace a tool's command builder, parser, session-id, usage or error extractors, executable or capability flags, or drive a tool that is not registered. `escapeArg` is exported for override builders.
