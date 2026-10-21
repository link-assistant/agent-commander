# `--use-agent-commander`: adopt agent-commander 0.12 result metadata (limits from session files, signals, background tasks, unset env)

> Filed as https://github.com/link-assistant/hive-mind/issues/3690 (issue #55 of agent-commander).

## Summary

The next agent-commander release, 0.12.0 (link-assistant/agent-commander#55, PR link-assistant/agent-commander#56), ports the Hive Mind v2.39.5 (`5a7cb68`) behaviour that `--use-agent-commander` was missing. `src/agent-commander.lib.mjs` cannot use most of it yet, because `summarizeAgentCommanderResult` copies only a fixed set of `result.metadata` fields and `appendExtraEnv` drops `null` values.

## What agent-commander now reports

| `result.metadata` field | Meaning | Hive Mind source it mirrors |
| --- | --- | --- |
| `limitReached`, `limitResetTime`, `limitTimezone` | Also set from the Codex rollout (`$CODEX_HOME/sessions/**/rollout-*-<thread>.jsonl`, last turn only) and from the Claude transcript (`${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<slug>/<session>.jsonl`, last entry `isApiErrorMessage`) when the output did not report a limit | #3570 |
| `limitResetsAt` (epoch seconds), `limitWindow` (`5-hour`, `weekly`, ...) | Exact reset from structured sources | #3570 |
| `limitSource` | `codex-rollout` / `claude-transcript` when the limit came from a session file | new |
| `signal`, `terminatedAfterResult` | Signal-aware exits; a process stopped after its completed result is not a failure | #1280, #3015 |
| `errorType` (`rate_limited`, `incomplete_stream`, `background_tasks_stopped`, ...), `errorMessage` | Classified failures; a server throttle is `rate_limited`, not a usage limit | #1924, #3015 |
| `apiError`, `apiErrorStatus`, `terminalReason`, `requestId` | Claude API failure details | `feca4bcfb` |
| `runningBackgroundTasks`, `backgroundTasksStopped`, `stoppedBackgroundTasks`, `printWaitCeilingSeconds` | Background tasks still running when the result arrived | #2301, #3015 |
| `observedModels`, `observedModel` | Models that actually answered (main and sub-agents) | #2840 |

And new options and helpers:

- `controller.stop({ closeTimeoutMs, backgroundWaitMs })` stops a process that stays alive after its final result (Claude `-p` hang) and kills the whole process group.
- `toolOptions.extraEnv` with a `null` value unsets an inherited variable (`env -u`), for example `ANTHROPIC_API_KEY: null` or `CODEX_HOME: null`.
- `canResumeCodexSession({ threadId, codexHome })` (#2888).
- `detectUsageLimitSources`, `isRecoverableToolError`, `applyCodexRolloutUsageLimit`, `applyClaudeTranscriptUsageLimit` for callers that drive the CLIs themselves.
- Rolling Claude aliases (`opus`, `sonnet`, `haiku`) are passed through unchanged, so `preserveRollingAlias` and agent-commander agree.

## Suggested changes in `src/agent-commander.lib.mjs`

1. In `summarizeAgentCommanderResult`, pass through `limitResetsAt`, `limitWindow`, `limitSource`, `signal`, `errorType`, `errorMessage`, `apiError*`, the background-task fields and `observedModels`. Use `metadata.errorDuringExecution` instead of `result.exitCode !== 0`, because a run stopped after its result has a signal exit code but succeeded.
2. Let `appendExtraEnv` keep `null`: agent-commander now treats it as "unset this inherited variable".
3. Before `resume` with `--tool codex`, call `canResumeCodexSession` and start a new session when the rollout is missing.
4. Bump `agent-commander` to `^0.12.0` in `package.json`.

## Related catalogue findings

- `src/agent-model-overlay.lib.mjs` (#2625) looks redundant. The pinned `@link-assistant/agent` 0.26.15 already defines `kilo/nemotron-3-super-free` (`nvidia/nemotron-3-super-120b-a12b:free`), `nemotron-3-ultra-free` and `nemotron-3.5-lightning-free` in `src/provider/kilo.ts` `FREE_MODELS` (also in 0.26.12 to 0.26.14).
- `src/models/catalog.mjs` still maps `kilo/glm-5-free`, `glm-4.5-air-free`, `deepseek-r1-free`, `giga-potato-free` and `trinity-large-preview`. These are not in agent 0.26.15's built-in Kilo list, so they resolve only if the live Kilo gateway catalogue (`https://api.kilo.ai/api/gateway/models`) still lists them. I have not checked whether it does. agent-commander keeps them because its map is a pinned copy of the Hive Mind catalogue.
