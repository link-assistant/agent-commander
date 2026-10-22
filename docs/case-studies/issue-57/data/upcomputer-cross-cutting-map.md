# upcomputer (krl-gr/upcomputer): agent-control features outside the GUI

I only read files and ran nothing from the repo. All paths are under `/tmp/research/upcomputer/`.

The gaps most relevant to agent-commander:
- **Usage-limit windows:** a reset time is attached to each limit failure, and a scheduler resumes the thread after the reset.
- **Failure taxonomy:** one set of failure classes is shared across providers, with a `retryable` flag.
- **Per-turn token accounting:** it has a `complete|partial|unavailable` status.
- **Cleanup of agent process trees:** process groups, systemd scopes and an OOM score adjustment.
- **Locked-down one-shot text-generation commands:** the exact flags are in section 8.
- **Git-ref checkpoints.**
- **Size-bounded NDJSON event logs.**

## 1. Usage and rate limits

**Normalized model.** `packages/contracts/src/providerUsageLimits.ts`
- L16-23: each window is `{id, kind: "session"|"weekly"|"monthly"|"other", label, usedPercent 0-100, resetsAt?, windowDurationMins?}`.
- L39-56: the snapshot adds `checkedAt`, `credentialFingerprint?`, `resetCredits?`, `externalUsage?` and `unavailable?: {reason: "unsupported"|"probeFailed"}`.
- L35-37 explains the two reasons: "distinguishes an account that can never report windows (API key, Bedrock) from a probe that failed this time".
- L59-63: updates are partial. "Claude's `rate_limit_event` names one window at a time ... Windows merge by `id` ... omitted windows are unchanged."

**Claude.** `apps/server/src/provider/claudeUsageLimits.ts`
- L24-25: `five_hour` maps to session and `seven_day` to weekly.
- L116-133: `claudeRateLimitEventToUpdate` turns the stream's 0-1 `utilization` into a percentage (`info.utilization * 100`).
- L136-147: the `get_usage` control request is already 0-100. `!response.rate_limits_available` gives `reason: "unsupported"`.
- L64-83: the `model_scoped` per-model weekly windows are "read structurally until the `.d.ts` catches up".
- Wiring: `orchestration-v2/Adapters/ClaudeAdapterV2.ts` L6431-6443, `if (message.type === "rate_limit_event")`, which calls `onUsageLimits`.

**Codex.** `apps/server/src/provider/codexUsageLimits.ts`
- L19-25: snapshot is `{limitId, planType, rateLimitReachedType, primary, secondary}`.
- L55-58: "`primary` / `secondary` are positions, not durations". Free and Go plans fall back to a monthly window (L66).
- L65: windows from other limit ids are ignored (`if (snapshot.limitId && snapshot.limitId !== "codex") return [];`).
- L146-170: `mergeCodexRateLimits` handles the partial `account/rateLimits/updated` notifications.
- L182-193: the next-step message depends on `rateLimitReachedType`, for example `workspace_owner_credits_depleted`.
- L195-210: user text such as `"Codex usage limit reached. The ${kind} limit resets in ..."`.
- L213-227: `codexUsageLimitResetAt` returns the latest reset among exhausted windows. Comment: "All exhausted windows must reset before a continuation can run."
- Probe: `provider/CodexProvider.ts` L493 calls `client.request("account/rateLimits/read", null)`, wrapped in `Effect.timeoutOption`.
- Live updates: `CodexAdapterV2.ts` L4327 handles `account/rateLimits/updated`.

**Antigravity.** `provider/antigravityUsageLimits.ts`
- Reads `antigravity-acp/acp_token.json` (L170) and refreshes the OAuth token at `https://oauth2.googleapis.com/token` (L216).
- POSTs `${endpoint}/v1internal:retrieveUserQuotaSummary`, falling back to `fetchAvailableModels` (L255-277).
- L93: `usedPercent: (1 - remainingFraction) * 100`.
- Timeouts: 10 s per request (L190) and 30 s overall (L288).

**Claude reset credits.** `provider/claudeResetCredits.ts`
- GET `https://api.anthropic.com/api/oauth/usage?cedar_ember=1&skip_spend=1` (L158-159), with headers `"anthropic-beta": "oauth-2025-04-20"` and `` `claude-cli/${version} (external, cli)` `` (L145-150).
- The token comes from `.credentials.json` `claudeAiOauth.accessToken`, skipped on darwin (L139-142).
- POST `/api/organizations/${org}/reset_rate_limits` with body `{program:"cedar_ember", grant_id, request_id}` (L223-234).
- L196-198: "`requestId` is the idempotency key".
- L241-246: HTTP 429 means rate limited; 401 or 403 means signed out.

**Reaction to a limit.** `orchestration-v2/UsageLimitRecoveryWorker.ts`
- A run qualifies when it is `status === "failed"`, `lastErrorClass === "usage_limit"` and has `usageLimitResetAt`.
- After the reset, and if the `autoResumeLimitedThreads` setting is on, it dispatches `text: "Continue where you left off."` with `usageLimitContinuationOfRunId`.
- It runs through `scheduler.register("usage-limit-recovery", sweep())`.

**Not found:**
- Automatic failover to another provider or account. Only manual handoff exists (`supportsProviderSwitchingViaHandoff: true`, ClaudeAdapterV2.ts around L262).
- Real usage ingestion: `provider/ProviderUsageLimitsIngestion.ts` is `Layer.empty`.

## 2. Token usage accounting

**Per-turn usage.** `packages/contracts/src/providerRuntime.ts` L322-347, `TurnTokenUsage`.
- `usageStatus` is `complete|partial|unavailable`.
- Fields: `inputTokens`, `outputTokens`, `cachedInputTokens?`, `cacheCreationTokens?`, `reasoningTokens?`, `hasSubagents`.
- Comment: "Input includes cache reads and writes. Output includes reasoning".

**Claude.** `provider/ClaudeTurnTokenUsage.ts`
- inputTokens = `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`.
- Reasoning comes from `output_tokens_details.thinking_tokens`.
- It carries usage across steer segments, because "A steer ends the running segment with an aborted result".

**Codex.** `provider/CodexTurnTokenUsage.ts`
- Computes the turn delta from the thread-wide cumulative `total` against a baseline. If the counters go down, it uses `last`.
- Comment: "Codex counts cache reads and writes inside inputTokens."

**Context-window gauge.** `orchestrationV2.ts` L959-968, `{usedTokens, maxTokens?, ..., promptCacheTtlMs?}`.
- Claude: `ClaudeAdapterV2.ts` L218-219 uses `inputTokens + outputTokens` against `claudeContextWindow(model)`.
- Codex: `CodexAdapterV2.ts` L196-197 uses `tokenUsage.last.totalTokens` against `modelContextWindow`.

**Transcript scanner.** `provider/Drivers/claudeUsage.ts`
- Reads `~/.claude/projects` JSONL `assistant` records and honors `CLAUDE_CONFIG_DIR`.
- Dedupes by `${messageId}:${requestId}`: "Summing them overcounts by roughly 2.4x".

**Cost.** `usage/usagePricing.ts`
- Uses LiteLLM per-token rates, including cache read and cache creation, plus fast and ultrafast tiers. User overrides are per million tokens.
- Source URL is in `UsageService.ts` L62: `https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json`.
- `contracts/src/usage.ts` defines `costSource: providerReported|modelPriced|unpriced`. Comment: "`reasoningTokens` is a *subset* of `outputTokens`".

## 3. Process management

**Generic runner.** `apps/server/src/processRunner.ts`
- L149-150: `DEFAULT_TIMEOUT = "60 seconds"`, `DEFAULT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024`.
- Options: `outputMode: "error"|"truncate"` and `timeoutBehavior: "error"|"timedOutResult"`.
- Typed errors for spawn, stdin, output limit, read and timeout.

**Login-shell PATH capture.** `packages/shared/src/shell.ts`
- L316: `execFile(shell, ["-ilc", ...], {timeout: 5000})`, with `__T3CODE_ENV_${name}_START__` markers.
- L202-209: uses `launchctl getenv PATH` on macOS.
- L802-805: extra directories `~/.local/bin`, `~/.opencode/bin`, `~/.grok/bin`.
- L727-786: on Windows, `resolveSpawnCommand` resolves `.cmd`/`.bat` files and builds an escaped `cmd.exe` line, because "passing args with `shell: true` prints DEP0190".
- `apps/server/src/os-jank.ts` also imports `__MISE_DIFF`, otherwise `exec mise x claude -- claude` "re-runs itself forever".

**Linux isolation.** `apps/server/src/process/agentScope.ts` and `packages/shared/src/AgentScope.ts`
- Agents start with `echo 800 >/proc/self/oom_score_adj`, then `systemd-run --user --scope --quiet --slice=app-t3code-agents.slice`.
- Properties: `--property=TimeoutStopSec=10s`, `--property=OOMPolicy=stop`. The slice has `MemoryHigh` and `MemoryMax` set.
- `stopLeftoverAgents`: "Old agents keep their scopes when the server is killed ... Stop them first, so two copies of one session never work in the same worktree".

**Process groups.** `ClaudeAdapterV2.ts` L236-254
- Spawns with `detached: true` and `stdio: ["pipe","pipe","ignore"]`. On exit it calls `signalProcessGroup(child.pid, "SIGKILL")`, because MCP grandchildren leaked (#3089).
- L764: "Windows has no process groups".

**Terminals** (`terminal/Manager.ts` L90-99):
- `DEFAULT_PROCESS_KILL_GRACE_MS = 1_000`.
- Escalates from SIGTERM to SIGKILL (L1575-1620).
- Uses node-pty.

## 4. Task agents and scheduling

**Scheduler.** `scheduling/Scheduler.ts`
- One `Effect.sleep("5 seconds")` loop that runs forever.
- Each source has its own `Semaphore.make(1)` with `withPermitsIfAvailable(1)`, so a source never overlaps itself.

**Task agents.** `packages/tasks-contracts/src/v1/agents.ts`
- Triggers: `startStatuses`, `startTags`, `startRunStatuses (failed|interrupted|blocked)`.
- Config: `{role, modelSelection, runtimeMode, interactionMode, tools, skills, instructions}`.

**Agent service.** `packages/tasks-server/src/agents/TaskAgentService.ts`
- At most one active run per task and agent.
- `thread.create` with `sidebarHidden: true`, then `sendToThread` (L1006-1046).
- L167-168: `PENDING_SESSION_START_TIMEOUT_MS = 2*60*1000`.

**Retries and result parsing.**
- `retryOperational.ts`: capped exponential backoff from 100 ms to 5 s.
- `TaskAgentResultParser.ts`: parses a fenced `task_agent_result` or json block containing `{status, summary, blocker, events[]}`.

**Scheduled tasks.**
- `scheduledTasks/Schedule.ts`: interval, fixed_time (HH:MM plus weekdays) or webhook. `MISSED_FIXED_TIME_GRACE_MS = 10 min`.
- `ScheduledTaskService.ts`:
  - Uses an idempotent `commandId` of the form `scheduled-task:${id}:${ms}:${trigger}` and runs with `concurrency: 1`.
  - Recovers rows stuck in `running` at startup.
  - Delivers with `sendToThread` `mode: "queue"`.
  - Supports webhook verification and templates.

**MCP tools exposing scheduling** (`mcp/toolkits/orchestrator/tools.ts` L117-160): `schedule_task`, `list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task`.

## 5. Checkpointing

- **Ref format** (`checkpointing/Utils.ts`): `refs/t3/checkpoints/${Base64Url(threadId)}/turn/${turnCount}`.
- **Durable writes** (`vcs/GitVcsDriver.ts` L786-791): `-c core.fsync=objects,reference -c core.fsyncMethod=fsync`, because "an unclean restart can leave 0-byte files under refs/t3/**".
- **Capture:** a temporary `GIT_INDEX_FILE` `t3-checkpoint-index-${uuid}` (L804), then `write-tree`, then `commit-tree <tree> -p HEAD -m "t3 checkpoint ref=..."` (L1025-1037), then `update-ref` (L1054).
- **Restore:** `restore --source <oid> --worktree --staged -- .`, then `clean -fd -- .`, then `reset --quiet -- .`.
- **Diff:** `diff --patch|--numstat -z --no-color --no-ext-diff --no-textconv [--ignore-all-space]`.
- **Callers:** `orchestration-v2/CheckpointService.ts` L287 and L398 (capture), L523 (restore), L551 (delete).

## 6. Event logging and observability

**Per-thread NDJSON provider log.** `provider/EventNdjsonLogger.ts`
- Three streams: `native`, `canonical`, `orchestration`, labelled `NTIVE`/`CANON`/`ORCH` (around L179-181). Files are `${prefix}${threadSegment}.log`, and `_global` is used when there is no thread.
- Limits (L29-39):
  - Rotation and retention: `DEFAULT_MAX_BYTES = 10 MiB`, `MAX_FILES = 10`, `MAX_TOTAL_BYTES = 512 MiB`, `MAX_AGE_MS = 14 days`.
  - Buffering: batch window 1 s, buffer 1 MiB or 512 records.
  - Per record: `MAX_RECORD_CHARACTERS = 64 KiB`, 1024 fields, depth 16.
- Token-delta noise is dropped (L45-64): `content.delta`, `item/agentMessage/delta`, `agent_message_chunk` and similar. Raw frames are skipped when a decoded copy exists ("Decoded frames carry the same information as raw frames", around L205).
- Oversized events become a summary (L339-370 `boundProviderEventForLogging`). The summary keeps whitelisted keys such as `session_id`, `api_error_status`, `terminal_reason`, `stop_reason` and `willRetry`, up to 8 KiB.

**Paths** (`config.ts`):
- L140: `server.trace.ndjson`, with trace limits of 10 MiB and 10 files (L199-200).
- L142: `providerLogsDir/events.log`.
- L58-63: OTLP URLs for traces, metrics and logs.

**Metrics** (`observability/Metrics.ts` L30-38): `t3_provider_sessions_total`, `t3_provider_turns_total`, `t3_provider_turn_duration`, plus counters for git, webhooks and secrets.

**Diagnostics:** `diagnostics/ProcessResourceMonitor.ts` reports `cpuPercent`, `rssBytes` and the top processes. The CLI command `t3 trace summary` (`cli/trace.ts` L150-200) prints "counts, rates, and latency".

## 7. MCP

**Built-in HTTP MCP server with per-session tokens.**
- `mcp/McpSessionRegistry.ts` L32-39: `issue`, `revokeProviderSession`, `revokeThread`, `revokeAll`. Tokens are stored as hashes (L132-133).
- `mcp/McpHttpServer.ts` L69-71: "Agents ... carry a registry token and must never be sent into an OAuth flow when it dies".

**Injection per CLI.**
- Codex (`CodexAdapterV2.ts` L1334-1341), passed as thread config: `mcp_servers: { [CODEX_T3_MCP_SERVER]: { url, tool_timeout_sec, http_headers: { Authorization } } }`.
- Claude (`ClaudeAdapterV2.ts` L783-800): `queryRuntime.setMcpServers(mcpServers)` with a 90 s timeout. Only server names are logged, because "Error texts ... can echo the headers".
- ACP: `mcp/AcpMcpStdioBridge.ts` L13-14, "ACP agents must support stdio MCP servers, while optional http/sse support is unevenly implemented". The hidden CLI commands are `acp-mcp-bridge` and `acp-mcp-call <tool> <json>` (`cli/acpMcpBridge.ts` L6-24). Comment: "The credential stays in the environment, never on the command line."

**Tools offered to agents.**

| Toolkit | Tools |
|---|---|
| Orchestrator (`orchestrator/tools.ts` L53-180) | `orchestrator_capabilities`, `delegate_task` (cross-provider child agent; `isolation: worktree`; `mode: async`/`wait`), `task_status`, `task_cancel`, `request_secret`, `create_threads` |
| Thread (`thread/tools.ts`) | `t3_queue_*`, `t3_pending_request_*`, `t3_thread_fork`, `t3_thread_merge_back` |
| Worktree (`worktree/tools.ts` L28-61) | `t3_worktree_handoff`, `t3_worktree_status`, `t3_worktree_list` |
| Project | `t3_project_*`, `t3_thread_launch` |

**MCP disabled for text generation:**
- Claude uses `--strict-mcp-config`.
- Codex uses `CODEX_NO_PLUGIN_ARGS` (`--config features.plugins=false --config features.apps=false`, `CodexTextGeneration.ts` L36-41).
- Codex also turns off every user server: it runs `codex mcp list --json` and passes `mcp_servers={"name"={enabled=false},...}` (L46-53, L171-173). The comment explains why: "`mcp_servers={}` merges into the user's servers rather than replacing them".

## 8. Text generation (exact commands)

Operations (`textGeneration/TextGeneration.ts` L30-35): `generateCommitMessage`, `generatePrContent`, `generateBranchName`, `generateThreadTitle`, `generateReviewGuide`.

**Claude** (`ClaudeTextGeneration.ts` L198-226). The prompt goes on stdin and the timeout is 180 s (L36).
```
claude -p --output-format json --json-schema <schema> --model <id> [--effort X]
  --settings '{"disableAllHooks":true,...}'
  (--tools "" | --tools Read,Grep,Glob,Bash --allowedTools Read,Grep,Glob,Bash(git diff:*),Bash(git log:*),Bash(git show:*) --disallowedTools "Bash(git * --output*),Bash(git * -o *)")
  --disable-slash-commands [--strict-mcp-config] --permission-mode dontAsk
```
- `--strict-mcp-config` is omitted when a managed-mcp.json is present: "Claude refuses this flag next to a managed-mcp.json".
- Title generation runs in a temporary directory (`t3code-claude-title-`).
- Output is read from `structured_output` (L54-65).

**Codex** (`CodexTextGeneration.ts` L287-313). The prompt goes on stdin and the timeout is 180 s (L31).
```
codex exec <launchArgs> --config features.plugins=false --config features.apps=false
  [--config mcp_servers={...=false}] --ephemeral --skip-git-repo-check -s read-only
  --model <m> --config model_reasoning_effort="<e>" [--config service_tier="<t>"]
  --output-schema <file> --output-last-message <file> [--image <p>]... -
```
- `CODEX_HOME` is set from the configured home path.

## 9. Worktrees

**Workspace strategy** (`orchestrationV2.ts` L504-520): `root`, `existing_worktree{worktreePath}` or `worktree{baseRef, branch?, startFromOrigin?}`.

**Create** (`vcs/GitVcsDriverCore.ts` L3417-3466):
- Default path is `<worktreesDir>/<repoName>/<branch with / replaced by ->`.
- Command: `git -c checkout.workers=N worktree add [-b new] <path> <ref>`.
- `GIT_PROGRESS_DELAY=0` forces progress output through the pipe.
- L3475: submodules are initialized, because "`git worktree add` leaves submodules empty".

**Remove** (L3808-3812): `-c status.showUntrackedFiles=normal worktree remove [--force]`. If the worktree is already gone, removal is a no-op.

**Path safety** (`worktreesDirectory.ts` L5-21): the setting must be absolute and must not be a filesystem root.

**Setup progress** (`contracts/src/worktreeSetup.ts` L10-25):
- Stages: `fetch|checkout|submodules|setup-script|agent`.
- Each stage has a status, a percent and a tail of recent output lines.
- The setup script is run from `project/WorktreeSetupTracker.ts`.
- Base-ref checks before launch: `ThreadLaunchService.ts` L255-285.

## 10. Error classification

**Shared classes** (`orchestrationV2.ts` L1248-1255): `usage_limit|provider_error|transport_error|permission_error|validation_error|unknown`.
- Failure shape: `{class, message ≤4096, code ≤128, retryable}`, with the note "Producers must redact credentials".

**Claude** (`ClaudeAdapterV2.ts` L2754-2833):
- A gateway 503 that wraps a 429 `rate_limit_error ... (reset after XhYmZs)` becomes `usage_limit` with a computed reset time.
- `terminal_reason === "blocking_limit"` or `api_error_status === 429` becomes `usage_limit`.
- 529 means overloaded.
- API retry events: 429 is `usage_limit`, a null status is `transport_error`, anything else is `provider_error`; all are marked retryable.

**Codex** (`CodexAdapterV2.ts` L4515-4553, L5556-5575):
- `usageLimitExceeded`/`rateLimitExceeded` become `usage_limit`.
- Codes starting with `http*`/`responseStream*` become `transport_error`.
- Everything else is `provider_error`.
- A terminal `usage_limit` failure gets `resetAt: codexUsageLimitResetAt(...)`.

**Other sources:**
- `provider/CodexManagedErrors.ts` L1-87: maps codes found anywhere in the error text, such as `subscription_sharing_usage_limit_exceeded` and `chatpass_v2_scope_not_authorized`, to user messages.
- `codexUsageLimits.ts` L133-144: probe failures are split into JSON-RPC errors, spawn failures and exits.
- `provider/Errors.ts` L17-26: `ProviderWorkspaceMissingError`.
- `providerCompatibility.ts` L25-36: CLI version policy `{ranges[{range, status}], recommendedVersion}`.

## 11. Remote and headless operation, and a non-interactive CLI

**Headless server** (`cli/server.ts` L59-69): `t3 serve` runs "without opening a browser and print[s] headless pairing details". The `--no-browser` flag and `T3CODE_NO_BROWSER` exist (`cli/config.ts` L53, L142).

**Background service** (`cli/service.ts` L116-200): install, restart, uninstall and status for a per-user service.

**Remote access:**
- `t3 pair` (`cli/pair.ts` L428-462): pairing token with a TTL, printed as a QR code, optionally `--tailscale` Serve HTTPS.
- `t3 auth pairing|session issue/list/revoke`.
- `t3 connect` for the cloud relay.
- SSH tunnel (`packages/ssh/src/tunnel.ts` L1163-1183): `ssh -o BatchMode=no -o ConnectTimeout=10 -o ExitOnForwardFailure=yes -o ControlMaster=no -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -n -N -L <local>:127.0.0.1:<remote>`. A hidden `__ssh-helper pick-port|wait-ready` command runs on the remote side (L588-597).

**Headless triggers:** scheduled-task webhooks (section 4) and the MCP tools `t3_thread_launch`/`delegate_task`.

**`t3 triage`** (`cli/triage.ts` L135-150): starts `claude` or `codex` (with `--agent` and `--model` flags) on a context file it writes. It is an interactive helper.

**Not found:** a CLI command that sends a prompt to a thread or agent and waits for the result. None of the `cli/*.ts` files dispatch `message.dispatch`, `thread.create` or `sendToThread`.
