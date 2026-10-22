# How upcomputer (krl-gr/upcomputer) launches and controls each provider

Repo root: `/tmp/research/upcomputer`. I only read files. Nothing in the repo was run or installed. Paths below are relative to the repo root. The 7 dimensions are abbreviated: **T** transport, **L** lifecycle, **M** models, **P** permissions, **I** inputs, **O** outputs, **H** install and health.

## 1. Claude Code (`apps/server/src/provider/ClaudeAdapterV2.ts`, `ClaudeProvider.ts`)
- **T:** It uses the Claude Agent SDK `query()` with a streaming prompt queue, not a hand-built shell command. The child runs in a detached process group with stdio `["pipe","pipe","ignore"]` (242-256). `ClaudeHome.ts` sets `CLAUDE_CONFIG_DIR`. `ClaudeExecutable.ts` picks `claude.exe`/`cli.js` on Windows.
- **L:**
  - Query options (1058-1179) carry `resume`, `sessionId`, `resumeSessionAt`.
  - Interrupt is `interrupt()` then close, with a 10s wait (8460-8544).
  - Steer re-queues the message with priority `"now"` (8610-8656). Compact sends `"/compact"` (8814).
  - Snapshot is unsupported (8961).
  - Rollback uses a new UUID or `resumeSessionAt` (8969-9043). Fork uses `forkSession` (9044-9100).
- **M:** `compileClaudeModelSelection` returns `apiModelId, effort, promptEffort, settings` (`apps/server/src/claudeModelOptions.ts:27-58`). Settings are `alwaysThinkingEnabled`, `fastMode`, `ultracode` (44-48). Live changes go through `setModel`/`applyFlagSettings` (856-955).
- **P:**
  - Runtime modes map to `plan/default/acceptEdits/auto/bypassPermissions/dontAsk` (1763-1810), with live `setPermissionMode`.
  - `canUseTool` (7692-7911) turns `AskUserQuestion` into a user_input request. `ExitPlanMode` becomes a proposed plan, and the tool call is then denied.
- **I:** System prompt is preset `claude_code` with `append`. Images go in as base64 blocks (1584-1678). MCP is injected through `setMcpServers`, not `--mcp-config` (729-787, 1181-1250).
- **O:** `includePartialMessages: true`. Token usage is normalized in `ClaudeTurnTokenUsage.ts`.
- **H:** `claude --version` (`ClaudeProvider.ts:508`). An SDK `initializationResult` probe runs at 346-426, with auth at 176-192. Manifest: supported `>=2.1.280`, graceful `2.1.111-2.1.280`.

## 2. Codex (`apps/server/src/provider/CodexAdapterV2.ts`, `CodexProvider.ts`)
- **T:** It runs `codex app-server` as JSON-RPC over stdio.
  - Args: `["app-server", ...launchArgs]` (`codexLaunchArgs.ts`), overridable with `T3CODE_CODEX_LAUNCH_ARGS`.
  - Command is `binaryPath || "codex"`, wrapped by `AgentScope.wrap` and `resolveSpawnCommand` (1370-1397, 1527-1541).
  - Env adds `CODEX_HOME` and `CODEX_INTERNAL_ORIGINATOR_OVERRIDE` (`CodexProvider.ts:387-392`).
  - `initialize` sends `experimentalApi: true` (394-405). It runs once per shared app-server, guarded by a semaphore (1777-1802).
- **L:**

  | Operation | JSON-RPC call | Lines |
  |---|---|---|
  | Start thread | `thread/start` | 6476-6488 |
  | Resume | `thread/resume` with `excludeTurns:true`, after `thread/unarchive` if archived | 6508-6547 |
  | Compact | `thread/compact/start` | 6580 |
  | Inject history | `thread/inject_items` | 6601-6618 |
  | Steer | `turn/steer {expectedTurnId, input, threadId}` | 6656-6690 |
  | Interrupt | `turn/interrupt` | 6709+ |
  | Unload | `thread/unsubscribe` | 6693-6697 |
  | Snapshot | `thread/read` with turns included | 7165-7186 |
  | Rollback | `thread/revert` | 7197-7271 |
  | Fork | `thread/fork` with `lastTurnId`, then a revert | 7272-7320 |

  Rollback needs `historyMode "paginated"`; otherwise the error is "legacy history, which Codex 0.156 cannot revert".
- **M:** Models come from `model/list` (`requestAllCodexModels`, or the ChatGPT variant for ChatGPT accounts) in the probe (458-520). `turn/start` carries `model`, `effort`, `serviceTier`, `summary:"detailed"`, and `collaborationMode {mode: plan|default, settings:{model, reasoning_effort, developer_instructions}}` (726-824).
- **P:** Runtime mode sets the turn defaults (676-715):

  | Mode | approvalPolicy | approvalsReviewer | sandbox |
  |---|---|---|---|
  | approval-required | `"untrusted"` | user | `readOnly` |
  | auto-accept-edits | `"on-request"` | user | `workspaceWrite` |
  | auto | `"on-request"` | `"auto_review"` | `workspaceWrite` |
  | full-access | `"never"` | user | `dangerFullAccess` |

  Linked projects become `writableRoots` (717-724). Server requests handled at 5049-5471: `item/commandExecution|fileChange|permissions/requestApproval`, `mcpServer/elicitation/request`, `item/tool/requestUserInput`.
- **I:** Images become `{type:"image", url:"data:<mime>;base64,..."}`, and attachment paths are added to the text (3142-3157). App context is sent as `{kind:"untrusted"}` additional context. MCP is set through thread config: `mcp_servers: {[CODEX_T3_MCP_SERVER]: {url, tool_timeout_sec: 65*60, http_headers:{Authorization}}}` (1316-1346). `CODEX_THREAD_CONFIG` enables `"tools.update_plan.enabled": true` (1307-1310).
- **O:**
  - Plans come from `turn/plan/updated` (4289). Usage comes from `thread/tokenUsage/updated` (4357); `CodexTurnTokenUsage.ts:70-90` takes deltas of total vs last.
  - It opts out of diffs: `optOutNotificationMethods: ["turn/diff/updated"]` (230).
- **H:**
  - Version is parsed from `initialize.userAgent`. Auth uses `account/read`. The probe also calls `skills/list` and `account/rateLimits/read`.
  - Unauthenticated message: "Codex CLI is not authenticated. Run `codex login`" (604-608).
  - Managed install: GitHub `rust-v0.156.1` tarballs with per-target sha256 (`CodexInstallation.ts:55-99`).
  - Manifest: supported `>=0.156.0`, broken `<0.149.0`, recommended `>=0.159.0`.

## 3. Cursor (`packages/provider-cursor/src/server`)
- **T:** No CLI process. `@cursor/sdk` runs in-process (`sdk.ts`, protocol `"cursor-agent-sdk.local"`, `CursorAgentSdk.ts:24`). `CursorSdk.ts:12-47` guards against SDK shell spawn crashes with markers `"dump_zsh_state"`, `"dump_bash_state"`.
- **L:** In `CursorAgentSdk.ts`:
  - Open is `Agent.create` / `Agent.resume(agentId, …)` (356-362). Turns use `agent.send(message,{…onDelta})` (427-441).
  - If a run is already active, it calls `Agent.listRuns` + `Agent.cancelRun` and retries (442-470).
  - `run.wait`/`run.cancel` (490-537). Close is `agent.close` (580).
  - In `adapter.ts`, steer fails with `SteerRunUnsupportedError` (2453-2459). Interrupt is `run.cancel` plus a 10s wait (2460-2475).
  - Rollback: "does not expose conversation rollback" (2577-2584). Fork: "does not expose native agent forks" (2586-2593).
- **M:** `Cursor.models.list({apiKey})` (`CursorSdkCatalog.ts:65-66`). `makeCursorAgentOptions` sets `{model, mode: plan|agent, …}` (`adapter.ts:302-327`). Model switching is supported; runtime-mode switching is not (85-161).
- **P:** Interactive approvals: none — "Cursor Agent SDK does not expose interactive approval requests." (2505). Instead, `cursorRuntimeAgentPolicy` (177-202) sets SDK `autoReview` and `sandboxOptions:{enabled}`. The sandbox is on unless full-access.
- **I:** `{text, images:[{data, mimeType}]}`, with runtime instructions appended to the text (2153-2192). MCP is `"t3-code": {type:"http", url, headers:{Authorization}}` (204-219). Setting sources: `project, user, team, mdm, plugins` (294-300).
- **O:** Deltas `text-delta, thinking-delta, tool-call-started, partial-tool-call, tool-call-completed, turn-ended, shell-output-delta` (1870-1920). Todos become `plan.updated` (1390-1498). Token usage: not found.
- **H:** Needs `CURSOR_API_KEY` (`adapter.ts:861`, `status.ts:274-345`). Version is `null`. Auth uses `Cursor.me`, plus browser login through `Cursor.auth.login` (`auth.ts:161-211`). Manifest: `>=2026.05.09`.

## 4. Grok Build (`packages/provider-grok/src/server`) — ACP
- **T:** Command `binaryPath || "grok"` with env `GROK_OAUTH2_REFERRER`, in a detached process group (`acpSupport.ts:67-103`). Args by mode (54-65):

  | Mode | Args |
  |---|---|
  | none | `["agent","stdio"]` |
  | auto | `["--permission-mode","auto","agent","stdio"]` |
  | full-access | `["agent","--always-approve","stdio"]` |
  | other | `["--permission-mode","default","agent","stdio"]` |

- **L:** Shared ACP (section 8). Cancel meta is `{cancelTrigger:"ctrl_c"}` (109). Grok-specific extensions: `x.ai/session/prompt_complete` (`xaiAcpExtension.ts:1490`) and `task_backgrounded`/`task_completed` (488-491).
- **M:** Default model is `"grok-build"` (184). Model and effort are set with `setSessionModel(modelId,{reasoningEffort})` (230-261).
- **P:** Supported modes are approval-required, auto, full-access (44-48). Options map to `"allow-edits-session"→acceptForSession` (120-146). Questions arrive as `x.ai/ask_user_question` (910) and plan exits as `x.ai/exit_plan_mode` (929).
- **I:** Shared ACP.
- **O:** Shared ACP, plus `x.ai/session_notification`.
- **H:** `grok --version` (`status.ts:395`). Auth comes from `grok models` output matching "you are logged in" / "not logged in" (252-258). The ACP initialize probe does not authenticate (340-362). Auth method is `"xai.api_key"` if `XAI_API_KEY` is set, else `"cached_token"`. Manifest: `>=1.0.13`.

## 5. OpenCode (`packages/provider-opencode/src/server`)
- **T:** `opencode serve --hostname=127.0.0.1 --port=…` over HTTP+SSE (`OpenCodeRuntime.ts:660-720`).
  - Env: `OPENCODE_SERVER_PASSWORD` and `OPENCODE_CONFIG_CONTENT`. v2 uses `OPENCODE_PASSWORD` instead (`v2/OpenCode2Server.ts:47-56`).
  - Client: `createOpencodeClient({baseUrl, directory, headers:{Authorization: Basic …}})` (646-658).
  - Kill: SIGTERM, 1s, then SIGKILL of the group (721-735). The server is shared with a 30s idle TTL (`OpenCodeServerOwner.ts`).
- **L:** In v1 `adapter.ts`:
  - `session.create` (3036-3044) and `session.promptAsync` (3259-3275).
  - `session.abort` (3441). `session.summarize` for compaction (3222).
  - Steer posts another prompt into the active turn (3316-3360).
  - Rollback is `session.fork` at a boundary message (3539-3576). Fork is `session.fork` (3623-3655).
  - v2 uses `@opencode/client/effect`: `interrupt`, `compact`, `fork`, `switchModel`, and inbox steer (`v2/adapter.ts:2337`).
- **M:** Catalog from `opencode models --verbose` (`OpenCodeRuntime.ts:971`). Prompts carry `model`, `agent` (`"plan"` in plan mode), `variant`.
- **P:**
  - Built from permission rules (582-690), not an OS sandbox. Comment: "OpenCode does not provide an OS sandbox".
  - Always allowed: `question, read, glob, grep, lsp, todowrite, task, skill`. Restricted: `bash, edit, webfetch, …`. Full-access allows `*`.
  - Events `permission.asked`/`question.asked` (2586-2603) are answered with `permission.reply`/`question.reply` (3490-3510).
- **I:** `system` plus file parts for images (`OpenCodeRuntime.ts:472-495`). MCP is added with `client.mcp.add({name:"t3-code", config:{type:"remote", url, headers, oauth:false}})` (992-1002).
- **O:** SSE `event.subscribe` (2712). Tokens = input + cache.read + cache.write, and output + reasoning (261-265).
- **H:**
  - `--version`; major `>=2` selects v2 (`versionProbe.ts:34,71`).
  - `MINIMUM_OPENCODE_VERSION "1.14.19"` (46).
  - npm package is `@opencode/cli` (v2) or `opencode-ai` (`driver.ts:86`).
  - Managed download pinned to `v1.19.3` (`apps/server/src/provider/OpenCodeInstallation.ts:62-85`).
  - Manifest: supported `>=2.0.18`.

## 6. Antigravity (`apps/server/src/provider/acp/`) — ACP
- **T:** The managed executable runs with args `["--uid="]` on Linux, else `[]`. Env adds `ANTIGRAVITY_HARNESS_PATH` with `extendEnv:false` (`antigravityAuthSupport.ts:407-432`). Download: `dl.google.com/agy-extensions/…/agy-acp-server-1.3.0-<platform>.zip` (`antigravityRelease.ts`). This conflicts with the manifest's `=1.1.1`.
- **L:** `resumeMethod:"resume"`, `cancelBehavior:"wait-for-prompt"` (`AntigravityAcpSupport.ts:45-89`).
- **M:** Selected with configOption `"model"`.
- **P:** `full-access→"yolo"`, `auto-accept-edits→"auto_edit"`, otherwise `"default"`. fs capabilities are on only with `clientFileSystem`; terminal is false.
- **I:** Shared ACP.
- **O:** Shared ACP.
- **H:** `authenticateEagerly: true`, default `"oauth-personal"`. Methods: oauth-personal, oauth-business, gemini-api-key, vertex. Env keys `GEMINI_API_KEY`, `GOOGLE_API_KEY`, … (64-70). The auth URL is scraped from stdout/stderr. Compatibility strips the `agy_acp_server_` version prefix (`providerCompatibility.ts`).

## 7. Pi (`packages/provider-pi/src/server`)
- **T:**
  - Command `binaryPath || "pi"` through `agentScope.wrap` (`adapter.ts:479-488`).
  - Args `["--mode","rpc", (--no-session), ...launchArgs, "--extension", <T3 ext>]` (`mcpInjection.ts:273-351`). Reserved user args include `--continue, --fork, --mode, --resume, --session` (22-40).
  - `extendEnv:false`, detached. Kill is SIGTERM, grace, then SIGKILL, or `taskkill /T /F` (`rpc.ts:170-240`).
- **L:** JSON RPC commands:
  - `prompt {message, streamingBehavior:"steer", images}` serves both start and steer (2546-2551, 2642-2649).
  - `abort` (2690). `new_session`/`switch_session {sessionPath}` (2187-2188). `compact` (580). `get_messages` (2801) for snapshots.
  - Fork is `fork {entryId}` (2900, 3026). Rollback uses `piRollbackForkEntry` and forks (2852+).
- **M:** `get_available_models`, `set_model`, `set_thinking_level` (2280-2327). Levels: `off … xhigh, max` (316).
- **P:** The T3 extension owns the permission hook (461-466). It hooks `pi.on("tool_call")` and calls `ctx.ui.confirm(\`Allow ${toolName}?\`)`, returning `{ block: true, reason: … declined in Up.computer. }` on refusal (`mcpExtensionSource.ts:327-342`). Read-only tools pass; file edits pass in auto-accept-edits. The adapter maps `extension_ui_request` methods `select|confirm|input|editor` to approval or user_input and answers with `extension_ui_response` (`adapter.ts:1213-1285`).
- **I:** Images go in the `prompt` command. MCP and instructions come through env for the extension (T3 MCP URL/bearer, user-instructions path).
- **O:** Live usage `input/cacheRead/output/totalTokens`; "Pi attaches the current message's cumulative usage to every streaming update (0.84.2+)" (694-711).
- **H:** `--version` (`status.ts:201`). There is no real auth check: `authenticated: discoveredModels.length > 0` (167). Manifest: `>=0.80.5`.

## 8. ACP registry / custom ACP agents (`packages/provider-acp-registry`, `packages/provider-acp`)
- **T:**
  - Registry: `"https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json"` (`AcpRegistrySupport.ts:49`).
  - Distributions: `binary` (with sha256), `npx`, `uvx`. Under `auto`, the order is `["binary","npx","uvx"]` (422-450). npx/uvx specs "must include an exact version" (80-96).
  - Managed installs: `npm install --global <spec>` or `uv tool install --force <spec>` (1247-1253). Binaries are sha256-verified (1486-1488).
  - Local custom agents: `spawn: { command, args: settings.commandArgs, cwd, env, shell: false }` (1789-1808).
  - Everything goes through shared `AcpSessionRuntime` (`AcpSpawnInput {command,args,cwd,env,extendEnv}`, `AcpSessionRuntime.ts:85-92`), wrapped as AgentScope `"acp"`, optionally with a Linux cgroup wrapper (1440-1495).
- **L:**
  - Resume uses `session/load` if `loadSession`, else `session/resume`, else `session/new` (2179-2229).
  - Cancel is `session/cancel`; on timeout the runtime is retired (2355-2375).
  - Fork is `session/fork`, head only (`adapter.ts:7442-7470`). Rollback spawns a replacement runtime with a new sessionId (7352-7440).
  - Steer is unsupported (6952). Kill is SIGTERM then SIGKILL on the group (1617-1639), or `taskkill /T /F` on Windows (1050).
- **M:** `session/set_model`, `set_mode`, `set_config_option`, and `customModels` (`provider-acp-registry/.../adapter.ts:158-161`).
- **P:**
  - `session/request_permission` (5224). Elicitation in form and URL modes (5395-5425).
  - Approval is required if approval-required or `approvalPolicy !== "never"` (`clientPolicy.ts:84-86`).
  - Plan mode uses mode id `"plan"`/`"architect"` (5963-5986).
  - Client capabilities: fs read/write and terminal default false (1788-1801).
- **I:** Images `{type:"image", data, mimeType}`, with instructions appended as text (6355-6380). MCP uses `acpMcpServers` if the agent has `mcpCapabilities.acp`, else `mcpServers` (2108-2120).
- **O:** `agent_thought_chunk, tool_call(_update), plan, usage_update, available_commands_update, config_option_update, current_mode_update` (3761-3776). Vendor extras: Copilot `github.com/copilot/sessionEvent` (`copilotAcp.ts:16`), plus `devinAcp.ts`.
- **H:** `probe.ts` runs `initialize` and reads `authMethods`, `loadSession`, `sessionCapabilities.list/resume/delete`, `auth.logout` (251-258). Auth is lazy after an auth-required error, or eager (2125-2240).

## 9. Muse (`packages/provider-muse/src/server`)
- **T:**
  - `@muse-code/sdk` `spawnMspConnection` (`sdk.ts:6-11`) runs `muse … serve`, wrapped as AgentScope `"muse"` (`adapter.ts:1614-1630`).
  - Args (`sdk.ts:139-150`):
    - Normal: `--trust-workspace`, plus `--disable-sandbox` for full-access.
    - Read-only probe: `--disable-shell --disable-write --no-session-log`.
  - Env drops `META_API_KEY` (53-61). Shutdown timeout 10s; startup timeout 20s.
  - `initialize` requests `["sessionMcp"]`, and the response must have schema version 1 (154-205).
- **L:** `session/start` / `session/resume {excludeItems:true}`, then `session/setApprovalMode` (`adapter.ts:1751-1777`).
  - `turn/start`. `turn/steer {expectedTurnId,input}` (2109-2125). `turn/interrupt` hits joined turns too, with a 30s wait (2160-2172).
  - `session/compact` (1955). `session/read` for snapshots (2016).
  - Rollback: "Muse Code does not support conversation rollback". Fork: "does not support native forks" (2256-2272).
- **M:** `model/list`, which must be `providerId "meta"` (`modelCatalog.ts:116-121`). `session/setModel` (1891).
- **P:**
  - `approvalMode`: `"allowAll"` for full-access, else `"promptUnmatched"`. `permissionProfile`: `":unrestricted"`, else `":ask-me"`. The code notes this avoids Muse's default `:auto-review` (`sdk.ts:126-137`).
  - Approvals are answered with `approval/decide {approvalId, requirementId, choiceId}` (1046-1050). Questions arrive as `request_user_input` (225, 1167-1172).
- **I:** Text with attachment paths, plus images as `{type:"image", base64Data, mediaType}` (1827-1846). MCP: `"t3-code": {transport:"streamableHttp", mode:"optional", url, headers}` (1736-1745).
- **O:** `session/tokenUsage`, `session/contextUsage`, `session/todoListChanged`, `turn/retryScheduled` (254-257). Capabilities: `supportsActiveSteering: true`, `canRollbackThread: false` (100-124).
- **H:** `--version` (`status.ts:75`). Auth is always unknown: "MSP has no auth signal, and model/list answers from Muse's cache even when logged out." (136-137). Manifest: `>=1.4.2`. The `-R<n>` suffix is stripped from versions.

## Cross-provider abstractions
- **Adapter interface:** `packages/provider-core/src/server/ProviderAdapter.ts:633-649`:
  > `ProviderAdapterV2 extends Context.Service<…, { instanceId; driver; getCapabilities(); planSelectionTransition(input); openSession(input): Effect<SessionRuntime, Error, Scope> }>`

  `SessionRuntime` (537-631):
  - Required: `ensureThread, resumeThread, startTurn, steerTurn, interruptTurn, respondToRuntimeRequest, readThreadSnapshot, rollbackThread, forkThread`.
  - Optional: `injectHistory, compactThread, stopTask, stopSubagent, unloadThread, mcpApps, getModelContextWindow, subscribeEvents, hasPendingBackgroundWork`.
- **Runtime policy:** `RuntimePolicy` (48-57) = `runtimeMode, interactionMode, cwd, additionalDirectories, approvalPolicy, sandboxPolicy, reasoningEffort`. Every driver maps it to its native knobs.
- **Adapter events:** The adapter-level union (81-170) is `provider_session.updated, provider_thread.updated, provider_turn.updated, node.updated, subagent.updated, message.updated, turn_item.updated, command_output.delta, runtime_request.updated, plan.updated, turn.terminal`, among others.
- **Canonical runtime events:** `packages/contracts/src/providerRuntime.ts:152-200` includes:
  - `session.started/configured/state.changed/exited`
  - `thread.started`, `thread.token-usage.updated` (159)
  - `turn.started/completed/aborted/plan.updated/proposed.delta/diff.updated`
  - `item.started/updated/completed`, `content.delta`
  - `request.opened/resolved`, `user-input.requested/resolved`
  - `task.*`, `hook.*`, `tool.progress/summary/denied`
  - `auth.status`, `account.rate-limits.updated`, `mcp.status.updated`, `model.rerouted`, `runtime.warning/error`
  - Raw sources: `"codex.eventmsg"`, `"claude.sdk.message"`, `"opencode.sdk.event"`, `"acp.jsonrpc"` (26-31).
- **Shared plumbing:**
  - `AgentScope.wrap` and `resolveSpawnCommand` for launches.
  - Process-group SIGTERM then SIGKILL, or `taskkill /T /F` on Windows.
  - One authenticated "t3-code" HTTP MCP server, injected per provider: SDK `setMcpServers`, Codex config, Cursor `mcpServers`, OpenCode `mcp.add`, ACP `mcpServers`, Pi extension env, Muse session config.
  - Shared `AcpSessionRuntime` behind Grok, Antigravity and registry agents.
  - Image attachments plus `providerMessageTextWithAttachmentPaths`.
- **Version compatibility:** `apps/server/src/provider/providerCompatibility.ts:59-103` matches the probed version against `model-manifest.json` ranges and returns `broken | unsupported | graceful`.
- **Not found:** No provider is driven by a one-shot shell command parsing NDJSON from stdout, which is agent-commander's model. All are long-lived protocol sessions:
  - SDK in-process (Claude, Cursor)
  - JSON-RPC (Codex, Muse)
  - ACP (Grok, Antigravity, registry)
  - HTTP+SSE (OpenCode)
  - RPC (Pi)

  Gemini, Qwen and `@link-assistant/agent` have no dedicated drivers. Gemini credentials appear only through Antigravity. Any of them would have to come in as ACP-registry or local ACP agents.
