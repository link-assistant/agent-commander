# Case Study: Normalized Result Metadata for Hive-Mind Solve Sessions (Issue #30)

## Problem Statement

Issue #30 asked `agent-commander` to expose a stable normalized result metadata object for hive-mind solve sessions. Hive-mind PR #1044 added an experimental `--use-agent-commander` execution path, but the adapter still had to parse raw tool output to recover fields that hive-mind already reports from its embedded adapters: success classification, session IDs, usage-limit reset details, summaries, costs, token usage, sub-agent calls, and execution errors.

## Evidence Collected

- Issue metadata and comments: `data/issue-30.json`, `data/issue-30-comments.json`, `data/issue-30-timeline.json`
- Prepared PR metadata and initial CI runs: `data/pr-31.json`, `data/pr-31-*.json`, `data/pr-31-recent-runs.json`
- Related hive-mind issue and PR data: `data/hive-mind-issue-1043.json`, `data/hive-mind-pr-1044*.json`
- Related upstream parity issue: `data/agent-commander-issue-29.json`, `data/agent-commander-issue-29-comments.json`
- Relevant hive-mind adapter sources from PR #1044: `data/hive-mind-agent-commander.lib.mjs`, `data/hive-mind-usage-limit.lib.mjs`
- Public solution log headers: `data/public-log-head.txt`
- Local reproduction and verification logs: `verification/*.log`

The public solution log linked from hive-mind PR #1044 is `66,343,582` bytes (`63.26M` from `curl -I`), so this case study records the URL and headers instead of committing the full generated log.

## Timeline

- 2025-12-31: hive-mind PR #1044 was opened to add experimental `--use-agent-commander`.
- 2026-05-01 05:12 UTC: agent-commander issues #29 and #30 were opened from that hive-mind integration review.
- 2026-05-01 05:38 UTC: hive-mind PR #1044 was updated with upstream follow-up links and verification details.
- 2026-05-01 06:59 UTC: issue #30 received the case-study and data-collection requirement.
- 2026-05-01 06:59 UTC: PR #31 was prepared as a draft branch for this issue.

## Requirements Extracted

1. Add normalized result metadata for `claude`, `codex`, `opencode`, and `agent`.
2. Keep existing result fields (`exitCode`, output, `sessionId`, and `usage`) backward compatible.
3. Include success/non-zero classification, usage-limit reset information, summaries, costs, stream usage, model usage, sub-agent summaries, and execution error details.
4. Implement the behavior in both JavaScript and Rust where the project exposes matching bindings.
5. Add a reproducing test before the fix and regression tests after the fix.
6. Document the new public result shape and add release fragments.

## Root Causes

### Consumer-Side Normalization

`agent-commander@0.4.3` already parsed tool streams enough to expose `output.parsed`, `sessionId`, and JavaScript `usage`, but it stopped before composing those pieces into a stable caller-facing summary. Hive-mind therefore had to maintain `summarizeAgentCommanderResult()` in its own adapter.

### Split Usage-Limit Logic

Hive-mind had mature usage-limit detection in `usage-limit.lib.mjs`, while `agent-commander` had no equivalent normalized limit fields. That meant callers could not reliably distinguish an ordinary non-zero exit from a quota or rate-limit stop without re-parsing plain output.

### Rust Parity Gap

Rust `AgentResult` did not expose aggregated usage at all, so even after adding JavaScript metadata, Rust would have remained behind the shared package behavior.

## Online Sources

- Claude Code programmatic output docs state that `--output-format json` includes result/session metadata and `stream-json` emits newline-delimited JSON events: https://code.claude.com/docs/en/headless
- Claude Code agent loop docs describe the final result as carrying final text, token usage, cost, and session ID: https://code.claude.com/docs/en/agent-sdk/agent-loop
- OpenAI Codex CLI docs describe `codex exec` as the non-interactive/programmatic mode, and the Codex SDK README describes JSONL event exchange and turn usage: https://raw.githubusercontent.com/openai/codex/main/codex-rs/README.md and https://raw.githubusercontent.com/openai/codex/main/sdk/typescript/README.md
- OpenCode CLI docs expose `opencode run --format json`, session continuation IDs, session export, and token/cost stats: https://opencode.ai/docs/cli/
- OpenTelemetry GenAI metrics recommend reporting token usage when it is available from a streaming response: https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-metrics/

## Solution Implemented

- Added JavaScript `buildNormalizedResultMetadata()` and exported it from the package root.
- Added `result.metadata` to JavaScript `stop()` results for normal execution and isolation stop commands.
- Added Rust `result_metadata` module, `ResultMetadata`, `PricingInfo`, `BuildMetadataOptions`, and `build_normalized_result_metadata()`.
- Added Rust `AgentResult::usage` and `AgentResult::metadata`.
- Normalized fields include `tool`, `exitCode`/`exit_code`, `success`, `sessionId`/`session_id`, limit reset details, cost estimates, summaries, optional model usage, stream usage, sub-agent calls, and error classification.
- Added root, JavaScript, and Rust README documentation.
- Added JavaScript Changeset and Rust changelog fragments.

No new external issue was opened: the missing metadata surface is the current upstream issue, and the separate parity-options gap is already tracked in issue #29.

## Reproduction Tests

Before the fix, `node --test test/index.test.mjs` failed the new Claude JSON result test because `result.metadata` was missing:

| Check                             | Before                                 |
| --------------------------------- | -------------------------------------- |
| `node --test test/index.test.mjs` | Failed at `assert.ok(result.metadata)` |

After implementation, the same test passes and asserts normalized session ID, Anthropic cost, result summary, stream token usage, and execution error classification.

## Verification Results

| Check                                                                                   | Result             | Log                                          |
| --------------------------------------------------------------------------------------- | ------------------ | -------------------------------------------- |
| `node --test test/index.test.mjs` before fix                                            | Failed as expected | `verification/js-metadata-test-before.log`   |
| `node --test test/index.test.mjs` after fix                                             | Pass, 11 tests     | `verification/js-metadata-test-after.log`    |
| `node --test test/result-metadata.test.mjs`                                             | Pass, 3 tests      | `verification/js-result-metadata-test.log`   |
| `cargo test test_agent_stop_includes_normalized_metadata_for_claude_json_result_output` | Pass               | `verification/rust-metadata-test-after.log`  |
| `cargo test result_metadata`                                                            | Pass, 2 tests      | `verification/rust-result-metadata-test.log` |
| `npm test`                                                                              | Pass, 168 tests    | `verification/npm-test.log`                  |
| `npm run check`                                                                         | Pass, 0 errors     | `verification/npm-check.log`                 |
| `cargo fmt --all -- --check`                                                            | Pass               | `verification/cargo-fmt-check.log`           |
| `cargo clippy --all-targets --all-features`                                             | Pass               | `verification/cargo-clippy.log`              |
| `cargo test --all-features --verbose`                                                   | Pass               | `verification/cargo-test.log`                |
