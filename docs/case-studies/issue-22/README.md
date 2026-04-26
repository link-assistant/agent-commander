# Case Study: Sync with hive-mind (Issue #22)

## Problem Statement

agent-commander was originally extracted from [hive-mind](https://github.com/link-assistant/hive-mind) on 2025-11-11 (commit `bd25d5a`). The model maps and best practices were re-synced on 2026-04-05 in PR #18 (issue #17). Issue #22 asks us to:

1. Determine the last sync date.
2. Compare hive-mind and agent-commander file trees so we don't miss features or bug fixes.
3. Sync any new model-map changes and tool best practices.
4. Examine the experimental bidirectional JSON I/O work for Claude and report what's missing in the other CLIs (and in `link-assistant/agent`, where issues should be filed).
5. Compile this case study under `docs/case-studies/issue-22/` with requirements, analysis, and a solution plan.

## Investigation Timeline

| Date | Event |
|------|-------|
| 2025-11-11 | Initial extraction from hive-mind (`bd25d5a`). |
| 2026-04-05 | Last full sync (PR #18 / issue #17). Brought Claude to 4.6 and added `minimax-m2.5-free` family. |
| 2026-04-08 — 2026-04-26 | Hive-mind continued evolving — Opus 4.7, gpt-5.5 family, `nemotron-3-super-free` default for agent. |
| 2026-04-26 | This sync (issue #22). |

So the gap to close in this iteration is ~3 weeks of hive-mind work, hive-mind versions roughly v1.49 → **v1.57.2** (latest release on 2026-04-26).

## Requirements (extracted from the issue)

1. Determine when the last sync happened.
2. Compare both repos' file trees so nothing is missed.
3. Sync model maps and bug fixes that landed in hive-mind after that date.
4. Investigate the bidirectional JSON I/O work that was started for Claude and replicate it for the other CLIs where supported.
5. File issues against `link-assistant/agent` for any missing bidirectional I/O capabilities (Codex too, "if they allow bidirectional input/output in JSON").
6. Compile data into `docs/case-studies/issue-22/`, list every requirement, propose solutions, and identify reusable components.
7. Search online for additional facts/data when relevant.

## Diff Summary — what's new in hive-mind since 2026-04-05

Source: `gh api repos/link-assistant/hive-mind/contents/src/models/index.mjs` (raw fetch on 2026-04-26) and `gh pr list --repo link-assistant/hive-mind --search 'merged:>2026-04-05'`.

### Model maps

| Tool | Change | Hive-mind PR |
|------|--------|--------------|
| Claude | `opus` now resolves to `claude-opus-4-7` (was `claude-opus-4-6`). New aliases `opus-4-7`, `claude-opus-4-7`. Added to `MODELS_SUPPORTING_1M_CONTEXT`. New `defaultFallbackModels.claude` map with `opus-4-7 -> opus-4-6`. | #1620, #1621 |
| Codex | New default `gpt-5.5`. New aliases: `gpt-5.5`, `gpt-5.5-mini`, `gpt-5.5-nano`, `gpt-5.4`, `gpt-5.4-mini`, `gpt-5.4-nano`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.1-codex-max`. New `CODEX_DEFAULT_FALLBACK_CHAIN` and runtime model resolution via `codex debug models`. | #1657 |
| Agent | Default changed to `nemotron-3-super-free` (NVIDIA hybrid Mamba-Transformer). `qwen3.6-plus-free` is now deprecated (free promotion ended April 2026). | #1543, #1564 (mirrors agent PR #243) |
| OpenCode | No changes. | — |
| Qwen | Not present in hive-mind; agent-commander remains the source of truth. | — |
| Gemini | Not present in hive-mind; agent-commander remains the source of truth. | — |

### Tool features (mostly Codex-heavy)

- PR #1602 (Apr 15): better Codex support; PR #1607 / #1604: Codex Playwright MCP setup docs.
- PR #1636 (Apr 18): Fix Codex pricing estimates.
- PR #1661 (Apr 24): Treat Codex error events as failed runs; PR #1697 (Apr 26): Fix Codex false failure on app-server stream lag (`getCodexErrorEventSummary` aggregates `itemErrors`, `turnFailures`, `streamErrors` and ignores non-fatal stream lag items).
- PR #1617: Preserve PR issue links after Codex auto-restart.
- PR #1674: Resume Codex stream disconnects.
- Claude: PR #1628 disables useless tools and MCP connectors in autonomous runs (`useless-tools.lib.mjs`); PR #1643 disables noisy Claude Code features in solve/Docker. New `src/claude.command-builder.lib.mjs` (89 lines) extracts shared command-building.

### Execution-layer (cross-tool)

- PR #1624: Playwright MCP fallback guidance for all tools.
- PR #1591: Sub-agent call tracking with per-call stats in budget display.
- PR #1599: Make all long sleeps interruptible (CTRL+C responsive).
- PR #1538: Retry on network issues with minimized terminal/log diff.
- PR #1542: Filter verbose log messages falsely emitted as error events.
- PR #1667: Retry capacity failures with fallback models (uses `defaultFallbackModels`).

### Infra / not for sync

Heavy Telegram-bot work (#1685, #1689, #1687, #1693, #1695), screen session monitoring, GitHub merge logic, Sentry integration. These belong to hive-mind's execution layer and stay there.

## Bidirectional JSON I/O Status

The issue specifically calls out the experimental Claude bidirectional JSON I/O. Here is what I found.

### Claude

- Hive-mind has `src/bidirectional-interactive.lib.mjs` (~710 lines) that drives a true bidirectional Claude session: writes NDJSON frames into stdin (`--input-format stream-json`), reads NDJSON frames from stdout (`--output-format stream-json --verbose`), and supports `--replay-user-messages` for live UI updates. Issue #817 / PR #843.
- agent-commander already has the building blocks: `claude.mjs` builds `--input-format stream-json` and `--output-format stream-json` flags; `streaming/input-stream.mjs` and `streaming/output-stream.mjs` produce/parse NDJSON. The `controller.start({ onMessage, onOutput })` API is in place. What is **not** in agent-commander is the live "attach a writer to stdin while reading from stdout" loop (e.g. `attachStreamingInput`).
- That live loop sits squarely in the execution layer. agent-commander deliberately stays as a thin command builder + parser (see issue #17 case study). So the right move is to **not** port the 710-line live driver, but to (a) confirm the flag generation is correct and (b) document a recipe.

### Other CLIs

| CLI | Stream-JSON output | Stream-JSON input | Notes |
|-----|--------------------|-------------------|-------|
| Claude | yes (`--output-format stream-json --verbose`) | yes (`--input-format stream-json`) | Only CLI with true bidirectional today. |
| Codex | yes (`--json` -> NDJSON) | no | Hive-mind pipes plain text via `cat promptFile \| codex exec`. OpenAI Codex CLI does not currently expose `--input-format stream-json`. |
| OpenCode | yes (`run --format json`, NDJSON) | no | No stdin JSON frame protocol documented. |
| Agent (`@link-assistant/agent`) | yes (NDJSON, OpenCode-compatible) | partial — accepts a single prompt via stdin but no NDJSON-frame-driven bidirectional loop. agent-commander declares `supportsJsonInput: true` because of the stdin support. | Needs an issue to add real `--input-format stream-json` parity. |
| Qwen | yes (`--output-format stream-json`) | declared `true` based on docs but no live bidirectional driver in hive-mind. | Worth verifying upstream. |
| Gemini | yes (`--output-format stream-json`) | no (`-p` flag for prompt) | Worth filing upstream FR. |

So the only CLI in the supported set with a real, working bidirectional NDJSON I/O contract today is Claude. The other CLIs need upstream support before agent-commander can offer the same.

## Root Cause Analysis

There is no defect — this is a planned periodic sync. The "root cause" of any drift is simply that hive-mind ships ~10× faster than agent-commander, and we periodically need to pull model-map changes and any execution-layer changes that genuinely belong in the thin layer.

The non-sync part of the issue (bidirectional JSON I/O for non-Claude tools) is upstream-blocked: the CLIs don't expose the input format, so we cannot replicate the bidirectional pattern in agent-commander until they do.

## Solution Plan

### 1. Sync model maps (this PR)

- **Claude (JS + Rust)**: change `opus` → `claude-opus-4-7`; add `opus-4-7` and `claude-opus-4-7` aliases; keep `opus-4-6` for backward compatibility.
- **Codex (JS + Rust)**: add the `gpt-5.5/5.4/5.3/5.2/5.1` family; change `defaultModel` from `gpt-5` to `gpt-5.5`; keep existing aliases.
- **Agent (JS + Rust)**: add `nemotron-3-super-free` (mapped to `opencode/nemotron-3-super-free`); change `defaultModel` from `minimax-m2.5-free` to `nemotron-3-super-free`; mark `qwen3.6-plus-free` deprecated (kept for backward compatibility).
- **OpenCode**: no model changes.
- **Tests**: update JS and Rust tests that assert the previous model IDs and defaults.
- **README**: update model-alias columns to reflect the new defaults.

### 2. File issues for missing bidirectional I/O

- Filed [link-assistant/agent#268](https://github.com/link-assistant/agent/issues/268): "Add bidirectional NDJSON I/O via `--input-format stream-json` (parity with Claude Code)". This includes the proposed input-frame contract, references to hive-mind's bidirectional driver, and a test plan.
- Codex bidirectional support requires upstream OpenAI work — the hive-mind driver itself says "Currently only supported for Claude due to `--input-format stream-json` support". No agent-commander-side work needed until OpenAI exposes the input format. (We could file a feature request against openai/codex if/when that becomes a priority for hive-mind.)

### 3. Future-sync candidates (not in this PR)

These are valuable but belong to subsequent issues, not this one:

- Pull `unicode-sanitization.lib.mjs` (~67 lines) — generic, would benefit `parseOutput` everywhere.
- Pull `parseModelWith1mSuffix` and `MODELS_SUPPORTING_1M_CONTEXT` to support Claude's `[1m]` 1M-token context window.
- Pull `getCodexErrorEventSummary` (~100 lines) into `codex.mjs` for richer error parsing.
- Centralize model maps into `js/src/tools/models.mjs` (mirror hive-mind's `src/models/index.mjs` pattern) so future syncs are diff-friendly.
- Pull `defaultFallbackModels` (Claude `opus-4-7 -> opus-4-6`, Codex chain) so callers can opt into auto-retry on overload.

These are listed in the "Recommendations for Future Syncs" section of issue-17's case study; this PR does not block on them.

## Verification Strategy

- `npm test` in `js/` passes after model-map and test updates.
- `cargo test` in `rust/` passes after model-map and test updates.
- A manual `start-agent --tool codex --dry-run --model gpt-5.5 --prompt "x"` shows the new model in the rendered command.
- The README "Supported Tools" table still renders truthfully (no claims of bidirectional NDJSON for non-Claude tools).

## Sources

- Issue: https://github.com/link-assistant/agent-commander/issues/22
- Previous sync issue: https://github.com/link-assistant/agent-commander/issues/17
- hive-mind models file: https://github.com/link-assistant/hive-mind/blob/main/src/models/index.mjs
- hive-mind bidirectional driver: https://github.com/link-assistant/hive-mind/blob/main/src/bidirectional-interactive.lib.mjs
- hive-mind issue tracking the pattern: https://github.com/link-assistant/hive-mind/issues/817
- hive-mind PR enabling Claude bidirectional: https://github.com/link-assistant/hive-mind/pull/843
- Opus 4.7 hive-mind PR: https://github.com/link-assistant/hive-mind/pull/1621
- gpt-5.5 / Codex defaults hive-mind PR: https://github.com/link-assistant/hive-mind/pull/1657
- `nemotron-3-super-free` agent PR: https://github.com/link-assistant/agent/pull/243
- link-assistant/agent README: https://github.com/link-assistant/agent#readme
- Claude Code permissions / `--input-format stream-json`: https://code.claude.com/docs/en/headless-mode
