# Hive Mind delta analysis for issue #55

- Baseline: Hive Mind `56b651c9ddec153b5b6fdb052fd063cd8f2343a1` (v2.33.14), which was the issue-50 parity pin.
- Target: Hive Mind `5a7cb68b7` (v2.39.5), 586 commits later. See `hive-mind-commits-since-baseline.txt` and `hive-mind-changelog-2.33.15-2.39.5.md`.
- agent-commander state: `4367abf`, which already includes the model catalogue sync to v2.39.5.
- Method: I read the Hive Mind source with `git diff` and `git show` only. No Hive Mind code was executed.
- Verification: each gap was checked against agent-commander's JS (`js/src`) and Rust (`rust/src`). The JS gaps marked "probe" were reproduced by calling agent-commander's own `buildNormalizedResultMetadata` from throwaway scripts outside the repo, which have since been deleted. The Rust gaps were verified by reading the code.

Classification:

- **(a)** already covered
- **(b)** general gap that belongs in agent-commander
- **(c)** Hive-Mind-specific policy

## How Hive Mind calls agent-commander now

The adapter is `src/agent-commander.lib.mjs`; a copy is in `hive-mind-agent-commander.lib.mjs.txt`. It changed in abd6b14bb, ca2e2fc5c, 68e05d5bd and 5d7f55e52.

- **Controller and output.** It uses `agent({ tool, json: tool !== 'agent', resume, ... })` and `start({ dryRun, attached: true, onOutput })`, which echoes output to stdout and stderr. For Gemini it sets `debug` when verbose.
- **Codex `extraArgs`.** It builds `-c service_tier=...`, `-c model_context_window=272000`, `-c features.goals=true`, the memory/auxiliary-disable overrides and `-c model_auto_compact_token_limit=...`. All of these go through the existing `extraArgs` passthrough, so they are (c) values on top of (a) plumbing.
- **Claude `extraEnv`.** It passes `MAX_THINKING_TOKENS`, `CLAUDE_CODE_EFFORT_LEVEL`, `CLAUDE_CODE_SHOW_THINKING`, `ANTHROPIC_DEFAULT_OPUS_MODEL`, `CLAUDE_CODE_SUBAGENT_MODEL`, `CLAUDE_CODE_DISABLE_1M_CONTEXT` and `CLAUDE_CODE_DISABLE_FAST_MODE`. These are (c) values on (a) plumbing.
- **Claude model.** It calls `mapClaudeModelToId(resolveClaudeModelForContext(model), { preserveRollingAlias: true })`, so `opus`, `sonnet` and `haiku` reach agent-commander unmapped. See gap M1.
- **Result handling.**
  - It trusts `metadata.success`, `metadata.errorDuringExecution || exitCode !== 0`, `limitReached`, `limitResetTime` and `limitTimezone` as they are.
  - Its own `isRecoverableAgentToolError` filter only runs when there is no metadata. Every wrong verdict agent-commander produces therefore reaches Hive Mind unfiltered.
- **Workarounds agent-commander should absorb.** These are the recoverable tool-error filter (A1), nested provider error text (A2) and the Claude and Codex usage-limit sources (C1-C6, X1-X5).

## (b) Gaps

### Claude Code

| ID | HM source | Gap | agent-commander location |
|---|---|---|---|
| C1 | 832cf3179 #3570 `src/claude.usage-limit-sources.lib.mjs:63-76` `classifyClaudeRateLimitEvent`; wired `src/claude.lib.mjs:662`, consulted on failure `:1044` | A structured `rate_limit_event.rate_limit_info` is ignored. It is a limit if `status === 'rejected'` and `resetsAt` is set, or if `utilization >= 1` and overage is unavailable. It is **not** a limit if it is `rejected` without `resetsAt` (that is a server throttle, #1924). | JS `js/src/result-metadata.mjs` `detectUsageLimit` (L89-118) and `buildNormalizedResultMetadata` (L413-478). Rust `rust/src/result_metadata.rs` `detect_usage_limit` (L185, text-only, needs `messages`), `build_normalized_result_metadata` (L565), and `ResultMetadata` (L18-36) |
| C2 | feca4bcfb #2687 `src/claude.lib.mjs` `processResultEvent` (~L513-575) | `result.api_error === "usage_limit_reached"` is not treated as a limit (probe: `limitReached:false`). | Same functions as C1 |
| C3 | feca4bcfb `src/claude.lib.mjs:575` | False positive: a 429 throttle text such as `"...(not your usage limit) · Rate limited"` matches `USAGE_LIMIT_PATTERNS`, so it reports `limitReached:true`. Rust `limit_reached` (L92-112) is looser still: it uses bare `"rate limit"`, `"limit reached"` and `"resets "`, and has drifted from JS #37. | JS `USAGE_LIMIT_PATTERNS` (L2-20) and `detectUsageLimit`. Rust `limit_reached`. Add `errorType:'rate_limited'` |
| C4 | 832cf3179 `claude.usage-limit-sources.lib.mjs:97-150` `observeEvent`; feca4bcfb | A string `error` is used as the *message* while `errorType` falls back to `message.type`. Probe result: `errorType:"assistant"`, `errorMessage:"rate_limit"`. `api_error`, `api_error_status`, `terminal_reason` and `request_id` are dropped. | JS `extractErrorFromMessages` (L283-320). Rust `extract_error_from_messages` (L426-477). Add new metadata fields |
| C5 | 832cf3179 `claude.usage-limit-sources.lib.mjs` (`/^\[log_[0-9a-f]+\]\s/`, `/^[A-Za-z0-9+/=]{120,}$/`), `classifyAnthropicDebugRateLimit` L79-91, `claude.lib.mjs:822,845` | With `ANTHROPIC_LOG=debug`, a base64 dump becomes `errorMessage` (probe). The `anthropic-ratelimit-unified-{status,reset,representative-claim}` 429 headers are not parsed. | JS `detectExecutionError` (L322-355). Rust `detect_execution_error` (L479-528) |
| C5b | 832cf3179 `readClaudeTranscriptApiError` L166-195 | Fallback (low priority): read the last assistant/user entry with `isApiErrorMessage:true` from `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<cwd-slug>/<session>.jsonl`. This is filesystem I/O, so offer it as an opt-in helper. | New helper in `js/src/tools/claude.mjs` and `rust/src/tools/claude.rs` |
| C6 | probe (affects the case agent-commander already covers) | The reset time is scraped from raw NDJSON, giving `limitResetTime: '11am (UTC)","terminal_reason":"api_error"}'`. | JS `detectUsageLimit` and `cleanResetTime` (L72). Rust `extract_reset_time` (L126-149) and `clean_reset_time` (L114): scan the extracted texts first and strip trailing `"}]` |
| C7 | 78b6ba634 #3015 `src/claude.process-exit.lib.mjs:98-105` `isProcessGroupAlive`; `claude.lib.mjs:456` SIGTERM, then SIGKILL after 5s | `terminate()` returns early once the `bash -c` wrapper has exited, so grandchildren that hold the pipe keep `close` from firing. `stop()` and `cancel()` can then hang. There is no SIGKILL escalation. | JS `js/src/executor.mjs` `terminate` (~L128) and `waitForExit` (~L112); `js/src/index.mjs` `stop` (L455-603), `cancel` (L621). Rust `rust/src/executor.rs` `terminate` (L95-123), `wait_for_exit` (L80-93); `rust/src/lib.rs` `stop` (L404), `cancel` (L577) |
| C8 | 78b6ba634 `claude.process-exit.lib.mjs:40-48`, `selectClaudeFailureMessage` L79 | Exit 143 after a successful result, when the caller killed the process itself, is reported as a failure, and `errorMessage` is the raw result JSON line (probe). | JS `buildNormalizedResultMetadata` (success at L453) and `detectExecutionError`. Rust: the same functions |
| C9 | 8f714aaef #3015 `src/claude.result-close.lib.mjs:42-80` `createClaudeBackgroundTaskTracker`, `:103-110` `planResultCloseTimeout` | There is no post-result close bound and no tracking of background tasks. Expose the task state and an optional `stop({ closeTimeoutMs })`; the timeout values themselves are (c). | JS new helper next to `js/src/completion.mjs`, used in `index.mjs` `stop`. Rust `completion.rs` and `lib.rs` `stop` |
| C10 | 78b6ba634 / 8f714aaef `src/claude.print-turn.lib.mjs:22,97-101` | A success `result` followed by `task_notification status:"stopped"`, or by stderr `Background tasks still running after Ns; terminating`, is reported as `success:true` (probe). Expose `backgroundTasksStopped` and `printWaitCeilingSeconds`. | JS `completion.mjs` `completionState` and `requireCompletedResult`. Rust `completion.rs` |
| C11 | 18c60a57f #2840 `src/observed-models.lib.mjs:27,93-102`; `claude.lib.mjs:664` | The served model is not exposed. `<synthetic>` is counted as a model in `resultModelUsage` (probe). | JS `extractResultModelUsage` (L199-234) plus a new `observedModels` field. Rust `extract_result_model_usage` (L294) |
| C12 | 5d7f55e52 #2771 `getClaudeEnv` deletes inherited vars | An inherited env var cannot be unset. Fix: accept `{ K: null }` and emit `env -u K`. | JS `js/src/tools/shell.mjs` `normalizeExtraEnv` / `buildCommandHead` (L37-100). Rust `rust/src/tools/shell.rs` `build_command_head` (L38) |

Native event shapes:

```json
{"type":"rate_limit_event","session_id":"s","rate_limit_info":{"status":"rejected","resetsAt":1792494000,"rateLimitType":"seven_day","utilization":1,"overageStatus":"rejected","isUsingOverage":false}}
{"type":"result","subtype":"success","is_error":true,"api_error":"usage_limit_reached","api_error_status":429,"result":"Quota exhausted","terminal_reason":"api_error"}
{"type":"result","subtype":"success","is_error":true,"api_error_status":429,"result":"API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited"}
{"type":"assistant","is_api_error_message":true,"error":"rate_limit","message":{"model":"<synthetic>","content":[{"type":"text","text":"You've hit your weekly limit · resets 11am (UTC)"}]}}
{"type":"system","subtype":"task_started","task_id":"t1","is_backgrounded":true,"task_type":"local_bash"}
{"type":"system","subtype":"task_updated","task_id":"t1","patch":{"status":"completed"}}
{"type":"system","subtype":"task_notification","task_id":"t1","status":"stopped"}
```

- **Window labels:** `five_hour`, `seven_day`, `seven_day_opus` and `seven_day_sonnet`.
- **Reset time:** epoch seconds, formatted in UTC. `1792494000` becomes `Oct 20, 2026, 11:00 AM`.

### Codex

| ID | HM source | Gap | agent-commander location |
|---|---|---|---|
| X1 | 8244c28db #3215; `src/usage-limit.lib.mjs:39-40` | The canonical phrase `You've hit your usage limit ... or try again at Jun 11th, 2026 12:27 AM.` in a top-level `{"type":"error"}` event, followed by a generic `turn.failed`, is not detected (probe: `limitReached:false`). | JS `USAGE_LIMIT_PATTERNS` and `RESET_TIME_PATTERNS`. Rust `limit_reached` (L92) and `extract_reset_time` (L126) |
| X2 | `src/codex-health.lib.mjs` (`filter(event => event.type !== 'item')`) | Limit text is taken from tool output (`item.completed` `aggregated_output`) on a failed run (probe: false positive plus a reset time full of JSON). Scan only top-level `error`, `turn.failed` and stderr. | JS `detectUsageLimit`. Rust `detect_usage_limit` and `build_normalized_result_metadata` |
| X3 | 96394c911 #2745 `src/codex.process-exit.lib.mjs:4-9` | The signal is dropped: `close(code=null, signal)` becomes exit 1, and 128+N is not mapped back to a signal. A run killed by a signal should never be reported as a usage limit. | JS `executor.mjs` `child.on('close')` (L112-114), `getOutput` / `waitForExit`, `index.mjs` `stop` (L530). Rust `executor.rs:90` `status.code().unwrap_or(1)`, and add `signal` to `ExecutionResult` (L11) and `ResultMetadata` |
| X4 | 96394c911 `findCodexStderrError` (`/^(?:error:\|fatal:\|(?:\/\S*\/)?(?:ba)?sh:\s)/i`, tracing regex `^\S*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(TRACE\|DEBUG\|INFO\|WARN\|ERROR)\s`) | On a non-zero exit, `errorMessage` is the last line, which is often a `RUST_LOG` tracing line (probe). It should prefer the last `error:` / `fatal:` / `sh:` line on stderr. | JS `detectExecutionError` (L322). Rust `detect_execution_error` (L479). Pass stderr separately |
| X5 | 33e182788 #3570 `src/codex-rollout-usage-limit.lib.mjs:43-56,66-90,99-119` | Add a rollout cross-check: in the last turn of `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread_id>.jsonl`, a `token_count.rate_limits.{primary,secondary}` entry with `used_percent >= 100` and `resets_at`, or an `error` with `codex_error_info: "usage_limit_exceeded"`, means a limit. Run it only on a non-zero exit with no signal, report the UTC reset time, and make it opt-in or best-effort. | New helper in `js/src/tools/codex.mjs` and `rust/src/tools/codex.rs`, called from `stop` / the metadata builder |
| X6 | 7b27c3ad5 / 641b25b30 #2888 `src/codex-sessions.lib.mjs` `findCodexRolloutFile` | Helper `canResumeCodexSession({ threadId, codexHome })`. Without a rollout file, `codex exec resume` fails with "no rollout found for thread id". The decision to drop resume stays with the caller (c). | Next to `buildArgs` (`codex.mjs:50`, `codex.rs:171`), sharing the walker with X5 |

Native event shapes:

```json
{"type":"error","message":"You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jun 11th, 2026 12:27 AM."}
{"type":"turn.failed","error":{"message":"stream disconnected before completion"}}
{"type":"event_msg","payload":{"type":"token_count","rate_limits":{"limit_id":"codex","primary":{"used_percent":100,"window_minutes":300,"resets_at":1792494000},"secondary":{"used_percent":41,"window_minutes":10080,"resets_at":1792900000},"rate_limit_reached_type":"primary"}}}
{"type":"event_msg","payload":{"type":"error","message":"You've hit your usage limit...","codex_error_info":"usage_limit_exceeded"}}
```

### Agent and OpenCode

| ID | HM source | Gap | agent-commander location |
|---|---|---|---|
| A1 | 68e05d5bd #3213 (PR #3225) `src/agent-error-events.lib.mjs:94-98` `isRecoverableAgentToolError`, `:135` (last fatal record wins); `agent-commander.lib.mjs:281` | A recoverable tool-error record (`recoverable:true`, or `part.type==='tool' && part.state.status==='error'`) becomes the failure reason. agent-commander also returns the **first** error record instead of the last fatal one. Recoverability is decided from the record's structure only, never from its text. | JS `js/src/tools/agent.mjs` `detectErrors` (L263), `result-metadata.mjs` `extractErrorFromMessages` (L283). Rust `rust/src/tools/agent.rs` `detect_errors` (L333), `result_metadata.rs` `extract_error_from_messages` (L426). OpenCode has no `detectErrors`, so for OpenCode only the `extractErrorFromMessages` change applies |
| A2 | 68e05d5bd `agent-error-events.lib.mjs:27-30` `extractAgentErrorText` | Nested provider error `{"type":"error","error":{"name":"ProviderAuthError","data":{"message":"..."}}}` gives "Unknown error" or "Execution failed". Fall back to `error.data.message` for the message and `error.name` for the error type. | Same four functions as A1 |
| A3 | 3fdc7d867 #3570 (PR #3571) `src/opencode.lib.mjs:361,389,551`; Hive Mind already counts only `reason === 'stop'` as completion | `step_finish` with `part.reason: "error"` counts as `completed`. This suppresses usage-limit detection, slices away the error record in `outcomeMessages`, and, if the exit code is 0, reports success. Map `reason:'error'` to `failed`, and scan non-recoverable error-record text for limits. | JS `js/src/completion.mjs` `completionState` (L31-34), `result-metadata.mjs` `detectUsageLimit` / `hasStructuredSuccess` (L85-118). Rust `rust/src/completion.rs` (L33-43), `result_metadata.rs` (L576-579) |
| A4 | e6d2555ba #2625 (PR #2626) `src/agent-model-overlay.lib.mjs:17-44,86` | The agent default is now `kilo/nemotron-3-super-free` (synced in 4367abf), but the Kilo provider overlay is not injected. Unless the Agent CLI ships that model, the default may not resolve. Hive Mind deep-merges `LINK_ASSISTANT_AGENT_CONFIG_CONTENT={"provider":{"kilo":{"models":{"nemotron-3-super-free":{"id":"nvidia/nemotron-3-super-120b-a12b:free","limit":{"context":262144,"output":32768}}}}}}`, and the user's own definition wins. | JS `js/src/tools/agent.mjs` `buildCommand` (`extraEnv`). Rust `rust/src/tools/agent.rs` build command. Check against the native Agent CLI first |

Native event shapes:

```json
{"type":"error","sessionID":"ses_1","part":{"type":"tool","tool":"read","state":{"status":"error","error":"Error: File not found: x"}},"message":"Error: File not found: x","error":"Error: File not found: x"}
{"type":"error","sessionID":"ses_1","error":{"name":"ProviderAuthError","data":{"message":"Formal AI provider rejected the request"}}}
{"type":"error","sessionID":"ses_3570","error":{"name":"APIError","data":{"message":"You've hit your weekly limit · resets 11am (UTC)"}}}
{"type":"step_finish","sessionID":"ses_3570","part":{"type":"step-finish","reason":"error"}}
```

### Models

| ID | HM source | Gap | agent-commander location |
|---|---|---|---|
| M1 | `src/claude.model-utils.lib.mjs:13` `ROLLING_CLAUDE_ALIASES = new Set(['opus','sonnet','haiku'])`; `pricing-tier.lib.mjs:228` adds `fable` | Only `opus` is passed through. `sonnet` and `haiku` get pinned to `claude-*-5-5`. `--fallback-model` is always mapped. | JS `js/src/tools/claude.mjs:90,95` `buildArgs`. Rust `rust/src/tools/claude.rs:165` |
| M2 | aa0e0c1e0 #3215/#3279 `src/formal-ai-model.lib.mjs:33-40` `canonicalFormalAiModel` (trim and lowercase) | Formal AI is matched case-sensitively, so `Formal-AI` passes through unmapped. This is low priority. | `js/src/tools/json-lines.mjs` `createModelMapper`, Rust `map_model_to_id` in each tool |

## (a) Already covered

- **Model catalogue sync to v2.39.5** (4367abf). It covers the Claude 5.5 family, the derived dotted aliases, `best`/`mythos`, Codex `sol`/`luna`/`astra`/daybreak, removal of `openai/formal-ai`, the agent Kilo alias, opencode `big-pickle`, Gemini rolling pass-through, and the Qwen catalogue.
- **Claude completion:**
  - `subtype:"success"` with `is_error:true` is treated as a failure.
  - "API Error" with exit 0 is treated as a failure.
  - An unterminated last NDJSON line is parsed.
  - Main-thread filtering uses `parent_tool_use_id`.
  - A completed last turn supersedes earlier errors (`outcomeMessages`).
- **Codex completion:**
  - `turn.failed` with exit 0 is a failure.
  - `turn.failed` text is preferred over item errors.
  - Non-fatal `item.*` errors are not treated as fatal.
  - The session id comes from `thread_id`, and the prompt is sent via stdin.
- **Agent:**
  - When `stop` follows a recoverable error, the run is a success.
  - In 0.26.14, a tool failure that appears only in `tool_use.part.state.status` is not flagged.
- **Passthrough:** `-c` overrides go through `extraArgs`, and `RUST_LOG`, `CLAUDE_CODE_*`, `MAX_THINKING_TOKENS` and similar go through `extraEnv`.
- **Prompt and argv quoting** (5f47dd946 #3282): `escapeArg`, plus the command-stream fixes in fbf2222 and 4367abf.
- **Process-group SIGTERM on cancel:** `process.kill(-pid)`, and `kill -TERM -- -pid` in Rust. The escalation is still missing (see C7).

## (c) Hive Mind policy

- **Pricing tier and speed values (#2771).** These are Codex `service_tier=default|flex|fast|ultrafast` and `model_context_window=272000`, Claude `CLAUDE_CODE_DISABLE_1M_CONTEXT` / `DISABLE_FAST_MODE` / `AUTO_COMPACT_WINDOW`, the `[1m]` suffix for opus-4-6 and sonnet-4-6 only, and the Gemini and Qwen compaction thresholds.
- **Codex feature and policy settings:** `features.goals=true` (#2406), memory/auxiliary-disable overrides, and the sub-session size.
- **Formal AI:** pinning, pricing and attribution (`applyServedModelPricing`, #3279), and the `primaryModelNames` lists.
- **Container and recovery:** cgroup OOM evidence and the memory-budget prompt, the Codex stderr trace-file routing (66b19e0d5 #2293), CODEX_HOME sessions symlink sharing, capability preflight, and dropping resume when there is no rollout file.
- **Retry and resume:** treating `error_during_execution` as possibly-completed, transient retry with `--resume`, the auto-resume after background tasks are killed, and the close-timeout values.
- **Diagnostics and helpers:** the repeated-tool-call loop report (#3211), the "recovered vs still failing" logging (#2924), version probes with a 5s timeout and 1 MiB cap (8b425e5d9), the runtime model-alias registry and `HIVE_MIND_MODEL_DEBUG`, and the `codex.last-message` 1 MiB cap.
- **Hive Mind infrastructure:** prompts, Telegram, GitHub retry, Docker and requirements reports.
- **command-stream:** Hive Mind pins 2.4.0 but calls agent-commander, not command-stream, for tool runs. agent-commander's command-stream adoption options are in `command-stream-analysis.md`.

## To verify against the native CLIs

- **Agent events on stderr.** Hive Mind #1151 (before the baseline) and the #3213 stub say `@link-assistant/agent` writes JSON events to stderr, at least with `--verbose`. agent-commander only parses stdout for agent runs. If that is true natively, such runs end as `incomplete_stream`.
  - **Checked** against the agent 0.26.15 package source (`src/cli/output.ts`): events, status, logs and warnings go to stdout; only `outputError` (fatal errors such as an unknown model) goes to stderr, pretty-printed unless `--compact-json`. Session runs therefore parse correctly, but such a fatal error was reported as `Process exited with code 1`. Both bindings now use the last JSON error record of the output when a failed exit has no error event on stdout (`experiments/agent-stderr-error.mjs`).
- **Kilo overlay.** Before injecting it (A4), check whether the Agent CLI already resolves `kilo/nemotron-3-super-free` natively.
  - **Checked:** agent 0.26.12 to 0.26.15 define it in `src/provider/kilo.ts` `FREE_MODELS`, so no overlay is injected.
