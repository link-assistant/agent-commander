# Shared Concepts

`agent-commander` has JavaScript and Rust implementations. The packages should keep the same user-facing behavior for common agent orchestration concepts, even when language-specific APIs differ.

## Tools

Both packages support these tool names:

| Tool       | Purpose                   | Read-only mode                                        |
| ---------- | ------------------------- | ----------------------------------------------------- |
| `claude`   | Anthropic Claude Code CLI | `--permission-mode plan`                              |
| `codex`    | OpenAI Codex CLI          | `--sandbox read-only`                                 |
| `opencode` | OpenCode CLI              | permission deny rules                                 |
| `qwen`     | Qwen Code CLI             | `--approval-mode plan`                                |
| `gemini`   | Gemini CLI                | `--approval-mode plan`                                |
| `agent`    | @link-assistant/agent     | `--permission-mode readonly` (`--plan-only` → `plan`) |

Unsupported tools can still be executed through the generic command builder, but read-only planning mode is rejected unless the tool has an enforceable native restriction.

## Per-command approval (ask mode)

Both packages support a uniform `--approve-each` flag (alias: `--permission-mode ask`) that asks the consumer to approve each command the agent wants to run, mapping to the backend's native per-command approval mechanism. When the backend exposes a drivable JSON handshake, each native permission request is relayed to the consumer as a normalized `permission_request` NDJSON event (with an opaque `id`, the `tool`, the resolved `command`/`pattern`, a `title`, and a `scope`); the consumer answers with a normalized `permission_response` carrying a decision of `once`, `always`, or `reject`, which is forwarded back to the native CLI in its own wire format.

`scope` documents what an `always`/allow decision attaches to — it deliberately differs per backend, so consumers should not assume a session-wide grant everywhere.

| Tool       | Native mechanism                                         | Scope              | Relay | Notes                                                                                                                  |
| ---------- | -------------------------------------------------------- | ------------------ | ----- | ---------------------------------------------------------------------------------------------------------------------- |
| `agent`    | `--permission-mode ask` (+ `--input-format stream-json`) | `session`          | ✅    | Native JSON `permission_request`/`permission_response` protocol; `once` \| `always` \| `reject` map 1:1.               |
| `claude`   | `--permission-mode default` (stream-json `can_use_tool`) | `tool-input`       | ✅    | `control_request`/`control_response` handshake; no session-wide `always`, so `once` and `always` both allow this call. |
| `codex`    | `--ask-for-approval` (coupled with `--sandbox`)          | `sandbox-coupled`  | ❌    | Approval is coupled with the sandbox policy and not exposed as a tool-agnostic JSON request/response stream.           |
| `qwen`     | `--approval-mode default`                                | `interactive-only` | ❌    | Headless mode has no relayable per-command JSON approval handshake.                                                    |
| `gemini`   | `--approval-mode default`                                | `interactive-only` | ❌    | No JSON stdin channel (prompt is passed via `-p`), so approvals cannot be relayed.                                     |
| `opencode` | `OPENCODE_PERMISSION` (static `{edit,bash,task}` policy) | `static-policy`    | ❌    | Only a static up-front policy is available; there is no per-command request/response relay.                            |

Only `agent` and `claude` can drive the handshake (`relay = ✅`). For every other tool, `--approve-each` is rejected up front with a clear error — the same pattern `--read-only` uses for tools without an enforceable native restriction.

## Launch options

Both packages map the same launch options onto each tool's native flag. A tool without a native flag rejects the option up front, naming the tools that support it, instead of dropping it silently. `getLaunchCapabilities(toolConfig)` / `launch_capabilities(tool)` report the matrix below.

| Option (JS / Rust / CLI)                                                | `claude`               | `codex`                                 | `opencode`   | `qwen`                  | `gemini`                | `agent` |
| ----------------------------------------------------------------------- | ---------------------- | --------------------------------------- | ------------ | ----------------------- | ----------------------- | ------- |
| `reasoningEffort` / `launch.reasoning_effort` / `--reasoning-effort`    | `--effort`             | `-c model_reasoning_effort=`            | `--variant`  | ❌                      | ❌                      | ❌      |
| `mcpConfig` / `launch.mcp_config` / `--mcp-config`                      | `--mcp-config`         | `-c mcp_servers={...}` (inline JSON)    | ❌           | `--mcp-config`          | ❌                      | ❌      |
| `strictMcpConfig` / `launch.strict_mcp_config` / `--strict-mcp-config`  | `--strict-mcp-config`  | ❌ (overrides merge with `config.toml`) | ❌           | ❌                      | ❌                      | ❌      |
| `additionalDirectories` / `launch.additional_directories` / `--add-dir` | `--add-dir`            | `exec --add-dir`                        | ❌           | `--include-directories` | `--include-directories` | ❌      |
| `attachments` / `launch.attachments` / `--attach`                       | ❌ (live-input images) | `--image` (`exec` and `exec resume`)    | `run --file` | ❌ (live-input images)  | ❌                      | ❌      |

`mcpConfig` takes a file path, inline JSON or (JavaScript) a `{mcpServers}` object. Codex receives the servers as one TOML `-c mcp_servers={...}` override: `headers` becomes `http_headers` and the transport `type` is implied by `command` or `url`. The TOML encoder in Rust writes keys in sorted order. Attachment paths that are relative resolve against the working directory; each path gets its own flag, because both native flags take several values.

## Tool version probe

`getToolVersion({ tool, executable, minimumVersion })` / `get_tool_version(tool, executable, minimum_version)` run `<tool> --version` (`buildVersionCommand` / `build_version_command`) and return `{ tool, installed, version, raw, meetsMinimum }`. `installed` is false when the shell cannot find or run the executable (exit 126 or 127). `version` is the first `x.y.z` in the output without a leading `v`. `meetsMinimum` is `null` / `None` when no minimum was asked for. `compareVersions` / `compare_versions` order versions, with a pre-release lower than its release.

## Usage windows and context usage

Result metadata carries two normalized views next to the token totals:

- `usageWindows` / `usage_windows`: subscription windows as `{ id, kind, label, usedPercent, resetsAt, windowDurationMins }`, where `kind` is `session`, `weekly`, `monthly` or `other`, `usedPercent` is 0-100 and `resetsAt` is in epoch seconds. Claude streams them as `rate_limit_event` messages (`five_hour` is the session window, every `seven_day*` type is weekly). Codex writes `rate_limits.primary` / `secondary` to its rollout `token_count` events, which `stop()` reads after the run because `codex exec --json` does not print them. App-server `account/rateLimits/*` notifications are recognized too.
- `contextUsage` / `context_usage`: how full the context window is, as `{ usedTokens, peakTokens, maxTokens, usedPercent, model, compactions }`. For Claude and Qwen a request fills input + cache writes + cache reads + output tokens. Sub-agent messages (`parent_tool_use_id`) are skipped, and `maxTokens` comes from the result's `modelUsage[model].contextWindow`. For Codex, `stop()` reads `last_token_usage.total_tokens` and `model_context_window` from the rollout. `compactions` counts `compact_boundary` messages. The value is `null` / `None` when the run reported no token usage.

The extractors are public for callers that read the streams themselves: `extractUsageWindows`, `usageWindowsFromMessage`, `mergeUsageWindows`, `extractContextUsage` and `contextReadingFromMessage` (snake_case in Rust).

## Live input

`liveInput: true` / `live_input: true` keeps the tool's stdin open as a stream-json channel for an attached run without isolation. The prompt becomes the first frame and JSON output is forced.

| Tool     | `sendMessage` / `send_message`       | `interrupt`                   | Notes                                                                        |
| -------- | ------------------------------------ | ----------------------------- | ---------------------------------------------------------------------------- |
| `claude` | text or content blocks (text, image) | `control_request` `interrupt` | Claude can read a queued message during the running turn.                    |
| `qwen`   | text or content blocks               | `control_request` `interrupt` | Qwen turns non-text blocks into JSON text.                                   |
| `agent`  | text                                 | ❌ (stop the agent instead)   | The message runs after the current turn.                                     |
| others   | ❌                                   | ❌                            | `codex`, `opencode` and `gemini` read a plain prompt, so `liveInput` throws. |

`endInput()` / `end_input()` closes stdin so the tool finishes the queued input and exits; `stop()` and `cancel()` also close it. In JavaScript, a run that also relays permission requests keeps stdin open until the last turn reports its result.

## Isolation

The shared isolation modes are:

- `none`: run the command directly in the working directory.
- `screen`: wrap the command in a named GNU Screen session.
- `docker`: run the command in a container with the working directory mounted.

`--dry-run` should print the command that would be executed without starting a process.

## Prompt Input

Both packages accept `--prompt <text>` / `prompt` for short prompts and `--prompt-file <path>` / `promptFile` / `prompt_file` for prompt content already stored on disk.

For `claude`, `codex`, `opencode`, `agent`, `qwen`, and `gemini`, the controllers also write in-memory prompts to temporary files at execution time and pipe those files into stdin. This keeps large generated prompts out of nested shell command strings while preserving the public API used by hive-mind and similar orchestrators.

For `codex`, `opencode`, `agent`, `qwen`, and `gemini`, the temporary file contains the system prompt followed by a blank line and then the user prompt. For `claude`, the temporary file contains the user prompt and the system prompt remains a Claude CLI system-prompt argument.

## Native Tool Passthrough

Both packages expose raw passthrough controls for the native commands for all six tools. These controls cover fast-moving upstream features without forcing every native CLI option into agent-commander's typed API:

- JavaScript `toolOptions.executable` / Rust `AgentOptions.executable` / CLI `--tool-executable`
- JavaScript `toolOptions.extraEnv` / Rust `AgentOptions.extra_env` / CLI `--tool-env KEY=VALUE`
- JavaScript `toolOptions.extraArgs` / Rust `AgentOptions.extra_args` / CLI `--tool-arg`
- JavaScript `toolOptions.skipDefaultSafetyFlags` / Rust `AgentOptions.skip_default_safety_flags` / CLI `--skip-default-safety-flags`

Passthrough environment variables are attached to the native tool side of prompt pipelines, so `cat prompt.txt | env KEY=value codex exec ...` applies `KEY` to `codex` without altering prompt-file reads. Raw arguments are appended after typed arguments, allowing callers to override or extend native CLI behavior such as MCP config, reasoning config, permission modes, sandbox modes, approval modes, and custom config paths.

Claude and Codex builders also expose typed `permissionMode` / `permission_mode`, `sandboxMode` / `sandbox_mode`, and `approvalMode` / `approval_mode` fields for callers that build commands directly. The `agent` builder exposes typed `permissionMode` / `permission_mode` (`auto` | `plan` | `readonly` | `ask`) and an OpenCode-compatible `permission` / `permission` JSON policy. `--read-only` maps to `readonly` and `--plan-only` maps to `plan` for `agent`.

## Tool overrides

When a built-in part of a tool breaks or is missing, a caller can replace it for one run without waiting for a release (issue #57). JavaScript takes `toolOverrides` and Rust takes `AgentOptions.tool_overrides` / `AgentCommandOptions.overrides` (`ToolOverrides`).

| Part                 | JavaScript (`toolOverrides`)                                                                                                                          | Rust (`ToolOverrides`)                                       |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Command builder      | `buildCommand(options)`                                                                                                                               | `build_command: Arc<dyn Fn(&AgentCommandOptions) -> String>` |
| Output parser        | `parseOutput({ output })`                                                                                                                             | `parse_output: Arc<dyn Fn(&str) -> Vec<Value>>`              |
| Session ID extractor | `extractSessionId({ output })`                                                                                                                        | `extract_session_id: Arc<dyn Fn(&str) -> Option<String>>`    |
| Usage extractor      | `extractUsage({ output })`                                                                                                                            | `extract_usage: Arc<dyn Fn(&str) -> Option<Value>>`          |
| Launch capabilities  | `supportsReasoningEffort`, `supportsMcpConfig`, `supportsStrictMcpConfig`, `supportsAdditionalDirectories`, `supportsAttachments`, `reasoningEfforts` | `launch_capabilities: Option<LaunchCapabilities>`            |
| Anything else        | any other tool configuration field, such as `detectErrors`                                                                                            | -                                                            |

- A builder returns the native command. The `cd` into the working directory and the isolation wrapper still apply. To extend a built-in, call it first: `tools.claude.buildCommand(options)` in JavaScript, or `build_base_command(&options)` in Rust.
- `escapeArg` / `escape_arg` quote values for the shell command a builder returns.
- A parser override also replaces the messages streamed during the run.
- With a builder, the override drives a tool that is not registered. The result metadata still uses the generic rules for such a tool.
- `resolveToolConfig({ toolName, toolOverrides })` returns the merged JavaScript configuration. The registered `tools` stay unchanged.
- Overrides do not relax read-only, plan-only or per-command approval. Those modes stay limited to tools with a native, enforceable switch.

The overrides complement the [native tool passthrough](#native-tool-passthrough) controls.

## Claude Options

Both packages expose Claude-specific options for model fallback, session management, prompt appending, verbose mode, and replaying user messages:

- `appendSystemPrompt` / `append_system_prompt`
- `fallbackModel` / `fallback_model`
- `sessionId` / `session_id`
- `forkSession` / `fork_session`
- `verbose`
- `replayUserMessages` / `replay_user_messages`

The CLI spellings are kebab-case: `--append-system-prompt`, `--fallback-model`, `--session-id`, `--fork-session`, `--verbose`, and `--replay-user-messages`.

## Releases

The repository publishes separate language packages from one codebase:

- JavaScript releases use Changesets, npm, `js_` tags, and `[JavaScript] vX.Y.Z` release names.
- Rust releases use changelog fragments, crates.io, `rust_` tags, and `[Rust] vX.Y.Z` release names.

Root documentation should link to the language README files. Package README files should include registry version badges so npm and crates.io package pages show the current package status.

## Dependency result contract

All six tools expose session IDs, usage and normalized metadata. Protocol messages and usage come from stdout; stderr remains raw diagnostics. Direct JSON runs require a native terminal event, including Agent's default NDJSON mode. A successful OS exit after an unfinished turn returns `success: false` and `errorType: incomplete_stream`. Plain text and generic commands retain exit-code-based behavior when no native lifecycle is observed.

`stop()` waits and collects for direct execution; `cancel()` signals the process and then collects. Unix executors signal the process group. Screen/Docker stop operations return wrapper-command status, so consumers needing the agent's final verdict should collect that inside their own isolation runner.

Common resume maps to `--resume` for Claude, Qwen and Gemini; `codex exec resume`; `opencode run --session`; and Agent's `--resume ... --no-fork`.

Claude and Qwen final result usage supersedes assistant snapshots. Codex fresh input excludes cached reads, exposed separately; output may include reasoning, so do not add reasoning tokens again. Agent and OpenCode sum step-finish usage. Gemini uses native result statistics. Native model usage and cost remain available without inventing provider prices.

The [issue #57 case study](case-studies/issue-57/README.md) covers the launch options, version probe, usage windows, context usage and live input added for hive-mind and upcomputer. The [issue #50 audit](case-studies/issue-50/README.md) records the source revision, complete feature inventory, alternatives and consumer migration plan.
