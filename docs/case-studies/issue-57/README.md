# Issue #57: Can upcomputer benefit from agent-commander?

This case study compares [krl-gr/upcomputer](https://github.com/krl-gr/upcomputer) ("The self-orchestrating control plane for coding agents", TypeScript, MIT) and [link-assistant/hive-mind](https://github.com/link-assistant/hive-mind) with agent-commander. It adds every general agent-control feature that either project needs and agent-commander lacked, in both the JavaScript and Rust bindings. It also makes the library replaceable piece by piece, so a consumer can swap a failing or missing part without waiting for a release.

Issue: [agent-commander #57](https://github.com/link-assistant/agent-commander/issues/57). Implementation: [PR #58](https://github.com/link-assistant/agent-commander/pull/58). The previous case study is [issue #55](../issue-55/README.md).

## Scope and method

The research date is 2026-10-22 UTC.

- **upcomputer.** Repository metadata is in [upcomputer-repo.json](data/upcomputer-repo.json) (88 stars, MIT, TypeScript). The provider drivers are mapped in [upcomputer-provider-launch-map.md](data/upcomputer-provider-launch-map.md), using 7 dimensions: transport, lifecycle, models, permissions, inputs, outputs, install and health. The cross-cutting services are mapped in [upcomputer-cross-cutting-map.md](data/upcomputer-cross-cutting-map.md): limits, tokens, processes, scheduling, checkpoints, logs, MCP, text generation, worktrees, errors and remote operation.
- **Hive Mind.** v2.39.5 (`5a7cb68`), the issue #55 pin. Its direct CLI calls were checked for flags that agent-commander could not express: `src/organize.ai.lib.mjs`, `src/claude.lib.mjs`, `src/codex.lib.mjs`, `src/agent-commander.lib.mjs`, `src/bidirectional-interactive.lib.mjs` and the `--version` probes.
- **Native CLIs.** Help and version output is in [cli-help](data/cli-help/). The versions are agent 0.26.15, claude 2.1.308, codex 0.163.0, gemini 0.64.0, opencode 1.19.3 and qwen 0.25.2. Each new flag was checked against this help text before it was used.
- **agent-commander.** The baseline is JavaScript 0.11.1 / Rust 0.3.2 when work started. `main` has since released Rust 0.4.0 with the issue #55 fragment. The fragments in this PR make the next release a minor one in both languages.

Both upstream repositories were treated as untrusted data. They were read and grepped only, never installed or run.

The issue has no comments, and PR #58 had no comments or reviews when work started.

The issue sets two rules for what belongs in agent-commander:

- **General.** Launching, steering and reading native agent CLIs. Any consumer of the library needs this. It was implemented in both languages, behind options that are off by default.
- **Project-specific.** Scheduling, checkpoints, worktrees, GUI, pairing and similar product features. These stay in the consumer. The new tool overrides make sure a consumer can still rebuild any general part that is missing or broken.

## Every issue requirement and its execution plan

| Requirement from the issue                                                         | Solution and plan                                                                                                                                                                                                                                                                                        | Delivered evidence                                                                                                                               |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| R1. Research whether upcomputer can benefit from agent-commander                   | Map every upcomputer provider driver and cross-cutting service, and compare each one with agent-commander's one-shot CLI model.                                                                                                                                                                          | [Answer](#answer-can-upcomputer-benefit), [data](data/)                                                                                          |
| R2. Add every agent-control feature hive-mind and upcomputer need and is missing   | Build a gap matrix, U1–U10 and H1–H5 below. Implement each general gap natively for every tool that has a native flag. Tools without one reject the option instead of silently dropping it. Ship each gap in JS and Rust with tests.                                                                     | [Gap table](#gaps-and-fixes); 7 new JS test files and 8 new Rust test files                                                                      |
| R3. Exclude project-specific features                                              | Classify every upcomputer and Hive Mind service as general or project-specific, and record why.                                                                                                                                                                                                          | [Left to the consumer](#left-to-the-consumer)                                                                                                    |
| R4. Maximum configurability and extensibility: consumers can replace failing parts | Per-run tool overrides in both languages. A consumer can replace the command builder, output parser, session-id, usage or error extractors, executable or capability flags of any tool, or drive a tool that is not registered. Shell quoting is exported so override builders can quote like built-ins. | JS `toolOverrides`, Rust `ToolOverrides`; [examples/tool-overrides.mjs](../../../examples/tool-overrides.mjs), `rust/examples/tool_overrides.rs` |
| R5. Do it in both JS and Rust                                                      | Every option, metadata field and helper has a counterpart with the same semantics. The Rust tests mirror the JS tests one to one.                                                                                                                                                                        | [Gap table](#gaps-and-fixes) lists both commits per gap                                                                                          |
| R6. Collect data in `docs/case-studies/issue-57`                                   | Save the issue, repository metadata, both upcomputer maps and the help text of all six CLIs.                                                                                                                                                                                                             | [data](data/)                                                                                                                                    |
| R7. Deep case study with online research                                           | Check each native flag against the vendor's documentation and the installed CLI's help text, and record the remaining limits.                                                                                                                                                                            | This document; [primary-source research](#primary-source-research)                                                                               |
| R8. List each requirement with solution plans and check existing components        | This table, the gap table, and the review of existing protocols and SDKs.                                                                                                                                                                                                                                | [Existing components](#existing-components-and-libraries)                                                                                        |
| R9. Everything in a single PR                                                      | Commit each atomic step to `issue-57-78ec18ab83ff`, add the changeset and changelog fragment, run the local checks and CI, then update PR #58.                                                                                                                                                           | PR #58; `js/.changeset/upcomputer-agent-control.md`, `rust/changelog.d/20261022_120000_upcomputer_agent_control.md`                              |

## Answer: can upcomputer benefit?

Yes for one-shot runs, and partly for its long-lived sessions.

All upcomputer drivers run long-lived protocol sessions ([provider map](data/upcomputer-provider-launch-map.md), "Cross-provider abstractions"):

| Protocol              | Providers                           |
| --------------------- | ----------------------------------- |
| SDK in-process        | Claude, Cursor                      |
| JSON-RPC (app-server) | Codex, Muse                         |
| ACP                   | Grok, Antigravity, the ACP registry |
| HTTP+SSE              | OpenCode                            |
| RPC                   | Pi                                  |

agent-commander instead launches a native CLI per run and parses its NDJSON output. That leads to three conclusions:

1. **Text generation and one-shot work fit directly.** upcomputer's commit-message, PR, branch-name and title generation runs exactly these one-shot commands ([cross-cutting map §8](data/upcomputer-cross-cutting-map.md)): `claude -p --output-format json --json-schema …` and `codex exec … --output-schema <file>`. With this PR they become `agent({ tool, jsonSchema, reasoningEffort, mcpConfig, strictMcpConfig, attachments })` plus `metadata.structuredOutput`, in either language. Locked-down flags such as `--tools ""` or `--ephemeral` go through `extraArgs`.
2. **Gemini, Qwen and `@link-assistant/agent` would be new providers.** upcomputer has no driver for any of the three. agent-commander already runs all three with normalized metadata.
3. **The long-lived drivers would only partly benefit.**
   - **What they can reuse:** agent-commander's normalization (usage windows, context gauge, error classes, version checks) and process-group termination.
   - **Live steer and interrupt:** available through `liveInput` for the stream-json CLIs (claude, qwen, agent). The JSON-RPC and ACP transports themselves are outside agent-commander's CLI model ([known limits](#known-limits)).

Hive Mind already depends on agent-commander. It gains native options for flags it currently builds by hand ([consumer migration](#consumer-migration)).

## Gaps and fixes

The U gaps come from upcomputer and the H gaps from Hive Mind. Where two commits are listed, the first is JavaScript and the second is Rust. A single commit covers both.

| ID  | Gap                                                                                                                                                                                                                             | Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | Commits                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| U1  | Reasoning effort could only be passed as raw `extraArgs`. upcomputer's `RuntimePolicy.reasoningEffort` drives Claude `--effort` and Codex `model_reasoning_effort`, and Hive Mind builds `-c model_reasoning_effort=…` by hand. | `reasoningEffort` / `launch.reasoning_effort` / `--reasoning-effort`. Maps to Claude `--effort`, Codex `-c model_reasoning_effort=`, and OpenCode `--variant`. The value is validated as a level name. Claude's documented levels are exposed as `reasoningEfforts` / `CLAUDE_REASONING_EFFORTS`.                                                                                                                                                                                       | `257cf4a`, `1f9c84f`            |
| U2  | No MCP server injection. upcomputer injects its MCP server into every provider, and Hive Mind passes `--strict-mcp-config --mcp-config <file>` to disable unwanted servers.                                                     | `mcpConfig` (path, inline JSON or a `{mcpServers}` object) and `strictMcpConfig`. Claude and Qwen get `--mcp-config` (Claude also `--strict-mcp-config`). Codex gets one `-c mcp_servers={…}` TOML override translated from the Claude format, with `headers` mapped to `http_headers`. `codexMcpServersOverride` and `toTomlValue` are public.                                                                                                                                         | `257cf4a`, `1f9c84f`            |
| U3  | No extra workspace directories (upcomputer `RuntimePolicy.additionalDirectories`, Codex `writableRoots`)                                                                                                                        | `additionalDirectories` / `launch.additional_directories` / repeatable `--add-dir`. Claude and Codex use `--add-dir`; Gemini and Qwen use `--include-directories`.                                                                                                                                                                                                                                                                                                                      | `257cf4a`, `1f9c84f`            |
| U4  | No CLI version probe. upcomputer checks each provider against a compatibility manifest (`providerCompatibility.ts`), and Hive Mind runs its own `--version` probes per tool.                                                    | `buildVersionCommand`, `parseToolVersion` (first semantic version in noisy output), `compareVersions` and `getToolVersion` / `build_version_command`, `parse_tool_version`, `compare_versions`, `get_tool_version`. Version ranges stay with the caller.                                                                                                                                                                                                                                | `6dec642`                       |
| U5  | Subscription windows were not reported. Only a reached limit was detected. upcomputer's `providerUsageLimits.ts` shows `{id, kind, label, usedPercent, resetsAt, windowDurationMins}` per window.                               | `metadata.usageWindows` / `usage_windows`, built from Claude `rate_limit_event` (`utilization` 0–1 converted to a percentage; `five_hour` is a session window, `seven_day` weekly) and Codex `rate_limits` (`primary`/`secondary` are positions, so the kind comes from `window_minutes`). Windows merge by `id`, and partial updates keep the windows they omit. `codex exec --json` does not stream rate limits, so `applyCodexRolloutUsageWindows` reads them from the rollout file. | `60773ae`                       |
| U6  | No live steer or interrupt. upcomputer steers running turns (Claude priority `"now"`, Codex `turn/steer`, Pi `streamingBehavior:"steer"`). Hive Mind has its own `bidirectional-interactive.lib.mjs`.                           | `liveInput: true` keeps stdin open as a stream-json channel. `sendMessage(text, { images })`, `interrupt()` and `endInput()` / `send_message`, `interrupt`, `end_input`. Supported by claude, qwen and agent; other tools throw `liveInputUnsupportedError`. The frame builders are public.                                                                                                                                                                                             | `a6ee043`, `6017aef`            |
| U7  | No context-window gauge (upcomputer `{usedTokens, maxTokens}`)                                                                                                                                                                  | `metadata.contextUsage` / `context_usage`. For Claude, the last request's input plus cache read and creation tokens. For Codex, `last_token_usage` against `model_context_window` from `token_count` events, or from the rollout file through `applyCodexRolloutContextUsage`.                                                                                                                                                                                                          | `4a3589d`                       |
| U8  | No image or file attachments (upcomputer sends images to every provider; its Codex text generation passes `--image`)                                                                                                            | `attachments` / `launch.attachments` / repeatable `--attach`. Codex uses `--image` (in both `exec` and `exec resume`), and OpenCode uses `run --file`. Claude and Qwen take images through `liveInput` `sendMessage(…, { images })` as base64 content blocks.                                                                                                                                                                                                                           | `36c349f`                       |
| U9  | No structured output (upcomputer and Hive Mind both run `claude --json-schema` and `codex --output-schema`, then read the answer themselves)                                                                                    | `jsonSchema` / `launch.json_schema` / `--json-schema`. Claude and Qwen use `--json-schema`. Codex uses `--output-schema <(printf '%s' …)`, so no temporary file is needed. The answer is `metadata.structuredOutput` / `structured_output`: Claude `structured_output`, Qwen `structured_result`, or the JSON text of Codex's last agent message.                                                                                                                                       | `30e0fa2`, `a8f1175`            |
| U10 | A consumer could not replace a broken or missing part of a tool without forking the library. The issue requires that "each project can just replace failing or missing part".                                                   | Per-run `toolOverrides` / `ToolOverrides` replace `buildCommand`, `parseOutput`, `extractSessionId`, `extractUsage`, `detectErrors` (JS), `executable` or any `supports*` capability for one run, and leave the registry untouched. Supplying a builder drives a tool that is not registered. `escapeArg` / `escape_arg` and `build_base_command` are exported for override builders.                                                                                                   | `f847dcb`, `8489e12`, `5b5b843` |
| H1  | Hive Mind's `organize.ai.lib.mjs` runs `claude --json-schema … --effort`, `codex exec --output-schema` and `qwen --json-schema` outside agent-commander                                                                         | Covered by U1 and U9.                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | see U1, U9                      |
| H2  | `claude.lib.mjs` and `useless-tools.lib.mjs` add `--strict-mcp-config --mcp-config <file>` by hand                                                                                                                              | Covered by U2.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | see U2                          |
| H3  | `agent-commander.lib.mjs` passes `-c model_reasoning_effort=` through `extraArgs`                                                                                                                                               | Covered by U1. The raw `extraArgs` path still works.                                                                                                                                                                                                                                                                                                                                                                                                                                    | see U1                          |
| H4  | `claude.connection.lib.mjs`, `codex.lib.mjs` and `agent.lib.mjs` each probe `--version`                                                                                                                                         | Covered by U4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | see U4                          |
| H5  | `bidirectional-interactive.lib.mjs` writes stream-json frames itself                                                                                                                                                            | Covered by U6. In JS, live input and the permission relay share one stdin channel.                                                                                                                                                                                                                                                                                                                                                                                                      | see U6                          |

Each launch option checks the tool's capabilities before the command is built. An unsupported option throws, and the error names the tools that do support it (`assertLaunchOptionsSupported` / `check_launch_options_supported`). The capability matrix is in [docs/common-concepts.md](../../common-concepts.md#launch-options). The documentation commits are `10d678f`, `5b5b843` and `8b9aee0`.

### Already covered before this PR

These upcomputer needs were already in agent-commander, mostly from issues #50 and #55:

| upcomputer need                                                                           | Existing agent-commander feature                                                                           |
| ----------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Error classes (`usage_limit`, `provider_error`, `transport_error`, `permission_error`, …) | `metadata.errorType`, `limitReached`, `limitResetsAt`, `limitWindow`, `limitSource`, `apiError*`, `signal` |
| Codex usage-limit reset from exhausted windows                                            | Codex rollout limit detection (`limitSource: 'codex-rollout'`) and `limitResetsAt`                         |
| Process groups, then SIGTERM, then SIGKILL                                                | Group termination with escalation and bounded draining (#55 C7)                                            |
| Turn token usage (input, output, cache, reasoning)                                        | `result.usage` and `metadata` token fields for all six tools                                               |
| Runtime modes and approvals (`approval-required`, plan, `full-access`)                    | `readOnly`, `planOnly`, `approveEach` with the permission relay, `skipDefaultSafetyFlags`                  |
| Resume and fork                                                                           | `resume`, `sessionId`, `forkSession`, `canResumeCodexSession`                                              |
| `CLAUDE_CONFIG_DIR` / `CODEX_HOME` and env control                                        | `extraEnv` / `toolEnv`, `null` / `unset_env` to remove a variable                                          |
| Served model                                                                              | `observedModels` / `observedModel`                                                                         |

### Left to the consumer

These were classified as product features. They stay in upcomputer and Hive Mind:

- scheduler, task agents and usage-limit auto-resume ("Continue where you left off" after `limitResetsAt`, which the metadata already provides);
- git-ref checkpoints, worktree creation and setup progress;
- the per-session HTTP MCP server and its tokens, the MCP orchestration tools, and the ACP-to-MCP bridge;
- text-generation operations (commit message, PR, branch, title) and their prompts;
- size-bounded NDJSON event logs, OTLP and metrics;
- systemd scopes, OOM scores, login-shell PATH capture and managed CLI downloads;
- pairing, remote access, the headless server and the GUI;
- the Claude OAuth usage and reset-credits API, and the Antigravity quota API, which are private HTTP endpoints rather than CLI behavior;
- in-process SDK drivers for Cursor, Grok, Pi, Muse and Antigravity, which have no one-shot CLI that agent-commander could wrap.

A consumer that needs one of these in agent-commander's style can add it per run with `toolOverrides` (U10) or `extraArgs`, without changing the library.

## Known limits

- **One-shot model.** agent-commander does not speak Codex app-server JSON-RPC, ACP, OpenCode's HTTP+SSE server or SDK sessions. Live steering exists only for the CLIs that read stream-json on stdin (claude, qwen, agent). Codex, OpenCode and Gemini read a plain prompt, so `liveInput` throws for them.
- **Strict MCP.** Only Claude has `--strict-mcp-config`. Codex merges `-c mcp_servers` into `config.toml` (checked with codex 0.163 `mcp list --json`), and Qwen has no strict flag, so `strictMcpConfig` is rejected for both. OpenCode reads MCP servers only from `opencode.json`, so `mcpConfig` is rejected for it. Gemini and agent have no MCP flag.
- **Attachments.** Gemini has no attachment flag. Qwen turns non-text content blocks into JSON text, so Qwen images sent through `liveInput` reach the model as text.
- **Structured output.** Not supported by gemini, opencode or agent, so the option is rejected for them. Codex's inline schema uses bash process substitution (`<(printf …)`). All commands run through `bash -c`, so this works, and the fake-codex experiment checks that `$HOME`, backticks and quotes survive. Qwen reads a value that starts with `@` as a path, so agent-commander always passes the schema inline. Rust's `serde_json` sorts object keys, so a Rust schema reaches the CLI with sorted keys. The Rust TOML encoder for Codex MCP config sorts them too.
- **Codex streaming.** `codex exec --json` streams neither `rate_limits` nor `token_count`, so usage windows and the context gauge for Codex come from the rollout file after the run.
- **Rust differences.**
  - Rust has no permission relay, so live input there is the only stdin channel, and `stop()` closes stdin at once.
  - `CodexRolloutLimitFacts` has no context field; Rust uses the separate `codex_rollout_context_usage` helper instead.
  - The Rust `ToolOverrides` has no `detect_errors` hook, because Rust error detection is built into the metadata builder.
- **Live input with the relay.** In JavaScript, a run with both the permission relay and live input keeps stdin open until the result arrives.
- **Overrides.**
  - Overrides do not relax read-only, plan or ask modes. The safety checks still run on the resolved tool.
  - An unregistered tool gets generic metadata unless its overrides extract more.
- **No live inference.** No paid inference was run. Native flags were checked against the installed CLIs' help text and vendor documentation, and the end-to-end paths use fake executables and `printf` overrides.

## Primary-source research

| Source                                                                                                                                          | Fact used                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Claude Code CLI reference](https://code.claude.com/docs/en/cli-reference)                                                                      | `--json-schema`: "Get validated JSON output matching a JSON Schema after the agent completes its workflow (print mode only)". `--effort` levels are `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`. `--strict-mcp-config`: "Only use MCP servers from `--mcp-config`". `--add-dir` adds working directories. `--input-format` takes `text` or `stream-json`. |
| [Claude Agent SDK structured outputs](https://code.claude.com/docs/en/agent-sdk/structured-outputs)                                             | "When the agent finishes, the result message includes a `structured_output` field with validated data matching your schema" (U9).                                                                                                                                                                                                                                  |
| [Codex non-interactive mode](https://learn.chatgpt.com/docs/non-interactive-mode) and [cli-help/codex-exec.help](data/cli-help/codex-exec.help) | "use `--output-schema` to request a final response that conforms to a JSON Schema"; with `--json`, "`stdout` becomes a JSON Lines (JSONL) stream". The help text lists `--image` on `exec` and `exec resume`, and `--add-dir` on `exec`.                                                                                                                           |
| [Agent Client Protocol](https://agentclientprotocol.com/overview/introduction)                                                                  | ACP "standardizes communication between code editors/IDEs and coding agents" over "JSON-RPC over stdio" for local agents. This is the session protocol behind upcomputer's Grok, Antigravity and registry drivers, and the reason they are outside the one-shot model.                                                                                             |
| [cli-help](data/cli-help/) (installed CLIs)                                                                                                     | `opencode run --file` and `--variant`, `gemini --include-directories`, `qwen --json-schema`, `--mcp-config` and `--include-directories`, and `agent` input and permission flags. These are the flags each option maps to.                                                                                                                                          |
| upcomputer source (read only)                                                                                                                   | The facts in both [maps](data/), with file and line references.                                                                                                                                                                                                                                                                                                    |
| Hive Mind v2.39.5 source (read only)                                                                                                            | `src/organize.ai.lib.mjs` lines 39–62 (schema and effort flags), `src/claude.lib.mjs` line 342 (strict MCP), `src/agent-commander.lib.mjs` line 98 (Codex effort through `extraArgs`), and the `--version` probes.                                                                                                                                                 |

## Existing components and libraries

The following were considered before writing new code:

- **Claude Agent SDK** (`@anthropic-ai/claude-agent-sdk`), which upcomputer uses. It is TypeScript-only and in-process, and it pins a bundled Claude Code. agent-commander must drive whatever `claude` binary is installed, from both JS and Rust. The SDK's message shapes (`rate_limit_event`, `structured_output`, stream-json input frames) are the same ones the CLI emits, so the parsers follow them.
- **Codex app-server JSON-RPC.** It is richer than `codex exec`, with live rate limits, steer and revert, but it is a different transport and is still marked experimental (`experimentalApi: true`). Adding it would be a new driver, not a launch option. The rollout file gives the same rate-limit and token data after a run.
- **ACP and the ACP registry.** A future ACP driver could cover Gemini (`gemini --acp`; `qwen --acp` too), Qwen and registry agents. It is a separate transport layer and does not replace the CLI runs this issue asks for.
- **OpenCode server SDK** (`@opencode-ai/sdk`). It is JavaScript-only and server-based. `opencode run --file/--variant` covers the one-shot needs.
- **command-stream.** It is still the quoting and terminal-capture base (issue #55). Process substitution for `--output-schema` reuses the shared quoting, so no new dependency was added.
- **Hive Mind libraries.** Hive Mind's `bidirectional-interactive.lib.mjs` and version probes informed U4 and U6. They were re-implemented generically rather than imported, as in issue #55.

## Consumer migration

Every new option and metadata field is additive. Existing callers work unchanged.

**Hive Mind** (`src/agent-commander.lib.mjs` and the direct CLI calls) can:

1. replace the `-c model_reasoning_effort=…` `extraArgs` with `reasoningEffort`;
2. replace hand-built `--strict-mcp-config --mcp-config <file>` with `mcpConfig` plus `strictMcpConfig`;
3. move `organize.ai.lib.mjs` onto `agent({ jsonSchema, reasoningEffort })` and read `metadata.structuredOutput`, instead of temporary schema and output files;
4. use `getToolVersion` instead of the per-tool `--version` probes;
5. use `liveInput` with `sendMessage` / `interrupt` instead of its own stream-json writer;
6. copy `usageWindows` and `contextUsage` into its result summary.

**upcomputer** can:

1. run its text generation (`ClaudeTextGeneration.ts`, `CodexTextGeneration.ts`) through agent-commander, using `jsonSchema`, `reasoningEffort`, `attachments`, `mcpConfig` and `strictMcpConfig`, with the lockdown flags in `extraArgs`;
2. add Gemini, Qwen and `@link-assistant/agent` providers as one-shot runs;
3. reuse `usageWindows` (the same shape as `providerUsageLimits.ts` windows), `contextUsage`, `getToolVersion` with its own compatibility ranges, and the error metadata, inside its long-lived drivers;
4. replace any part that does not fit its product through `toolOverrides`.

## Validation

```bash
cd js && npm run check && npm test
cd rust && cargo fmt --all -- --check && cargo clippy --all-targets --all-features -- -D warnings && cargo test --all-features && cargo doc --no-deps
node experiments/issue-57-launch-options.mjs
node experiments/issue-57-structured-output.mjs
```

Results on 2026-10-22:

- **JavaScript.** ESLint: 0 errors, and the same 30 warnings as `main`. Prettier and the duplication check pass. 417 tests pass, 0 fail.
- **Rust.** `fmt`, pedantic `clippy -D warnings`, the 1000-line file limit and `cargo doc` pass. 403 tests pass, 0 fail.
- **Launch-options experiment.** It prints the native command for each tool, and the unsupported combinations fail with the error naming the supporting tools.
- **Structured-output experiment.** A fake `codex` receives the `--output-schema` process substitution and reads the schema back intact, including quotes, `$HOME` and backticks (`OK: schema intact`).
- **Release fragments.** `get-bump-type.mjs` reports `bump_type=minor` with both Rust fragments.

### Deno on Windows CI

`JS Test (deno on windows-latest)` failed on `main` (run 39782822431) and on this PR: `test/command-stream.test.mjs` timed out after 10 s. Most runs passed it in 2-3 s. To find out why, `js/experiments/command-stream-windows-timing.mjs` timed the same probe on the runner three ways: plain `node`, Git Bash `-c`, and command-stream's `$` (runs 39812119048 and 39812129854). The first `node.exe` launch printed after 4.5 s on one runner and 9.4 s on the other. Every later launch took 55-116 ms, and nothing hung. The test now launches `node --version` once before the quoting check, and its budget is 60 s so that cold start fits.
