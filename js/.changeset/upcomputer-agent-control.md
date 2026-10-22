---
'agent-commander': minor
---

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
