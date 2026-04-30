# Case Study: Hive-Mind `--use-agent-commander` Support (Issue #27)

## Problem Statement

Issue #27 asked for `agent-commander` to support the requirements introduced by hive-mind PR 1044, which adds an experimental `--use-agent-commander` path. The work needed to verify the full hive-mind `src` tree, keep JavaScript and Rust behavior aligned, and document the compatibility evidence.

## Evidence Collected

- agent-commander issue: https://github.com/link-assistant/agent-commander/issues/27
- agent-commander PR: https://github.com/link-assistant/agent-commander/pull/28
- hive-mind PR 1044: https://github.com/link-assistant/hive-mind/pull/1044
- hive-mind PR 1044 source branch inspected locally at `/tmp/hive-mind-1044`
- hive-mind current code search for `agent-commander`, `start-agent`, and `--prompt-subagents-via-agent-commander`
- Online references:
  - Node.js `child_process.spawn()` documents command-plus-argument spawning, shell handling risks, and stdin pipes: https://nodejs.org/api/child_process.html
  - IBM `getconf` documentation records `ARG_MAX` as the maximum argument length for running a program, including environment data: https://www.ibm.com/docs/en/zos/2.5.0?topic=descriptions-getconf-get-configuration-values

## Hive-Mind Source Inventory

The PR 1044 branch contained 65 files in `src` totaling 27,606 lines. Every file was included in the source review; files that directly affect agent-commander integration are marked "direct".

| Lines | File | Relevance |
| ---: | --- | --- |
| 365 | `agent-commander.lib.mjs` | direct: imports `agent()` / `isToolSupported()` and runs tools through agent-commander |
| 684 | `agent.lib.mjs` | direct: native @link-assistant/agent runner baseline |
| 189 | `agent.prompts.lib.mjs` | prompt expectations |
| 58 | `buildUserMention.lib.mjs` | issue/user mention formatting |
| 792 | `claude-limits.lib.mjs` | Claude usage/rate-limit parsing |
| 50 | `claude.budget-stats.lib.mjs` | Claude budget parsing |
| 89 | `claude.command-builder.lib.mjs` | direct: native Claude command shape |
| 1500 | `claude.lib.mjs` | direct: native Claude execution baseline |
| 206 | `claude.prompts.lib.mjs` | direct: start-agent prompt guidance on main branch |
| 520 | `codex.lib.mjs` | direct: native Codex execution baseline |
| 197 | `codex.prompts.lib.mjs` | direct: start-agent prompt guidance on main branch |
| 194 | `config.lib.mjs` | config plumbing |
| 255 | `contributing-guidelines.lib.mjs` | prompt context input |
| 205 | `exit-handler.lib.mjs` | shutdown behavior |
| 145 | `git.lib.mjs` | repository state handling |
| 246 | `github-issue-creator.lib.mjs` | GitHub issue workflows |
| 127 | `github-linking.lib.mjs` | GitHub URL parsing |
| 276 | `github.batch.lib.mjs` | GitHub batching |
| 258 | `github.graphql.lib.mjs` | GitHub GraphQL access |
| 1497 | `github.lib.mjs` | issue/PR data collection |
| 290 | `hive.config.lib.mjs` | direct: `--use-agent-commander` config on PR 1044 |
| 1500 | `hive.mjs` | direct: hive CLI flag passthrough |
| 187 | `instrument.mjs` | telemetry wrapper |
| 974 | `interactive-mode.lib.mjs` | interactive prompting |
| 201 | `lenv-reader.lib.mjs` | environment loading |
| 481 | `lib.mjs` | shared utilities |
| 176 | `lino.lib.mjs` | line-oriented output |
| 32 | `list-solution-drafts.lib.mjs` | solution draft listing |
| 325 | `local-ci-checks.lib.mjs` | verification commands |
| 411 | `memory-check.mjs` | runtime memory guard |
| 138 | `model-mapping.lib.mjs` | direct: model alias expectations |
| 278 | `model-validation.lib.mjs` | direct: model validation expectations |
| 541 | `opencode.lib.mjs` | direct: native OpenCode execution baseline |
| 188 | `opencode.prompts.lib.mjs` | prompt expectations |
| 158 | `protect-branch.mjs` | branch protection |
| 434 | `review.mjs` | PR review command |
| 638 | `reviewers-hive.mjs` | reviewer orchestration |
| 287 | `sentry.lib.mjs` | error reporting |
| 581 | `solve.auto-continue.lib.mjs` | auto-continue flow |
| 1493 | `solve.auto-pr.lib.mjs` | PR creation/update flow |
| 312 | `solve.branch-errors.lib.mjs` | branch error handling |
| 228 | `solve.branch.lib.mjs` | branch setup |
| 429 | `solve.config.lib.mjs` | direct: `--use-agent-commander` config on PR 1044 |
| 198 | `solve.error-handlers.lib.mjs` | solve error handling |
| 283 | `solve.execution.lib.mjs` | solve execution flow |
| 430 | `solve.feedback.lib.mjs` | feedback loop |
| 1312 | `solve.mjs` | direct: solve CLI flag passthrough |
| 185 | `solve.preparation.lib.mjs` | context preparation |
| 99 | `solve.repo-setup.lib.mjs` | repo setup |
| 1198 | `solve.repository.lib.mjs` | repository cloning/fetching |
| 719 | `solve.results.lib.mjs` | result parsing |
| 120 | `solve.session.lib.mjs` | session state |
| 336 | `solve.validation.lib.mjs` | solve validation |
| 575 | `solve.watch.lib.mjs` | watch mode |
| 324 | `start-screen.mjs` | screen helper |
| 302 | `task.mjs` | direct on current main: uses `start-agent` for subagent prompts |
| 1485 | `telegram-bot.mjs` | Telegram integration |
| 64 | `telegram-markdown.lib.mjs` | Telegram formatting |
| 309 | `telegram-top-command.lib.mjs` | Telegram commands |
| 214 | `usage-limit.lib.mjs` | usage-limit parsing |
| 529 | `version-info.lib.mjs` | version reporting |
| 41 | `version.lib.mjs` | version constants |
| 111 | `youtrack/solve.youtrack.lib.mjs` | YouTrack solve flow |
| 214 | `youtrack/youtrack-sync.mjs` | YouTrack sync CLI |
| 423 | `youtrack/youtrack.lib.mjs` | YouTrack API helpers |

## Requirements Extracted

1. Keep `agent({ tool, workingDirectory, prompt, systemPrompt, model, json, resume })` compatible with PR 1044's `agent-commander.lib.mjs` wrapper.
2. Preserve `start({ dryRun, attached, onOutput })`, `stop()`, `getSessionId()`, parsed output, usage extraction, and exit-code behavior.
3. Support hive-mind tools `claude`, `codex`, `opencode`, and `agent` with model mapping, resume support where native tools provide it, and read-only support where enforceable.
4. Keep JavaScript and Rust public behavior aligned.
5. Avoid embedding large generated prompts in nested shell command strings.
6. Document the compatibility analysis and add regression coverage.

## Root Cause

The PR 1044 wrapper passes full solve prompts into `agent()` in memory. Before this fix, `agent-commander` rebuilt those prompts into shell command strings:

- `codex`, `opencode`, and `agent` used inline `printf '%s' '...' | tool`.
- `claude` used `--prompt "..."`.
- All tool commands were nested inside `bash -c "cd ... && ..."`.

That was fragile for hive-mind solve prompts because shell metacharacters must survive multiple quoting layers, and very large prompts can exceed the operating system's argument budget. The online `ARG_MAX` and Node child-process references confirm that process launches are bounded by command/argument size and that stdin is the appropriate channel for large child-process input.

## Solution Implemented

- Added `promptFile` / `prompt_file` / `--prompt-file` support.
- Added automatic temporary prompt-file creation for in-memory prompts when the tool reads prompt input from stdin.
- For `codex`, `opencode`, and `agent`, temporary prompt files contain `systemPrompt`, a blank line, and `prompt`.
- For `claude`, temporary prompt files contain `prompt`; `systemPrompt` remains a Claude CLI argument to preserve existing semantics.
- Added cleanup for temporary prompt directories after process completion or stop.
- Added JavaScript and Rust tests that launch a fake `agent` executable with a 3 MiB shell-sensitive prompt and assert the exact stdin byte count.
- Added command-builder tests proving prompt content is not embedded when `promptFile` is supplied.
- Updated README/common-concepts docs plus JavaScript and Rust release fragments.

## Verification

Reproducing checks before the fix:

| Check | Result |
| --- | --- |
| `node --test js/test/command-builder.test.mjs` | Failed as expected before implementation because prompt-file command support was missing |
| `cargo test test_build_agent_command_codex_prompt_file --manifest-path rust/Cargo.toml` | Failed as expected before implementation because Rust command options had no `prompt_file` field |

Final local verification:

| Check | Result |
| --- | --- |
| `npm test` from `js/` | Pass, 164 tests |
| `npm run check` from `js/` | Pass, 0 errors; lint complexity/size findings are warning-only in this project |
| `bun test` from `js/` | Pass, 164 tests |
| `deno test --allow-read --allow-run --allow-env --allow-net test/**/*.test.mjs` from `js/` | Pass, 163 passed and 1 ignored because the large-prompt fake executable test requires write permission that the Deno CI job does not grant |
| `cargo fmt --all -- --check` from `rust/` | Pass |
| `cargo clippy --all-targets --all-features` from `rust/` | Pass |
| `node ../scripts/rust/check-file-size.mjs` from `rust/` | Pass |
| `cargo test --all-features --verbose` from `rust/` | Pass |
| `cargo test --doc --verbose` from `rust/` | Pass |
| `cargo build --release --verbose` from `rust/` | Pass |
| `cargo package --list --allow-dirty` from `rust/` | Pass |
