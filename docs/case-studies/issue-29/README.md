# Case Study: Hive-Mind Execution Parity Options (Issue #29)

## Problem Statement

Issue #29 reported that hive-mind PR 1044 could route basic execution through `agent-commander@0.4.3`, but could not express several native execution controls from the public `agent-commander` API. The missing surface affected `claude`, `codex`, `opencode`, and `agent`, especially custom binaries, custom environment variables, raw native CLI arguments, permission/sandbox/approval modes, MCP configuration, context/compaction settings, and large-prompt handling.

## Evidence Collected

- agent-commander issue: https://github.com/link-assistant/agent-commander/issues/29
- agent-commander PR: https://github.com/link-assistant/agent-commander/pull/32
- hive-mind issue 1043: https://github.com/link-assistant/hive-mind/issues/1043
- hive-mind PR 1044: https://github.com/link-assistant/hive-mind/pull/1044
- Saved GitHub data: `data/issue-29.json`, `data/issue-29-comments.json`, `data/pr-32.json`, `data/hive-mind-issue-1043.json`, `data/hive-mind-pr-1044.json`, PR comments/reviews, recent CI run metadata, npm/crates metadata, related issue data, and `data/hive-mind-pr-1044.diff`.
- Saved linked execution log: `data/gists/solution-draft-log-pr-1767184590221.txt` from Gist `8003a42c6572876a7e8334779793153f`.
- Online references:
  - Claude Code environment variables: https://code.claude.com/docs/en/env-vars
  - Claude Code MCP configuration: https://code.claude.com/docs/en/mcp
  - Claude Code settings and permissions: https://code.claude.com/docs/en/configuration
  - Codex CLI overview: https://developers.openai.com/codex/cli
  - Codex CLI command-line options: https://developers.openai.com/codex/cli/reference
  - Codex configuration reference: https://developers.openai.com/codex/config-reference
  - OpenCode configuration reference: https://opencode.ai/docs/config
  - @link-assistant/agent README: https://raw.githubusercontent.com/link-assistant/agent/main/README.md

## Timeline

| Time                    | Event                                                                                                                                                                        |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2025-12-31 11:45:09 UTC | hive-mind issue 1043 opened, asking for an experimental `--use-agent-commander` path for `claude`, `codex`, `opencode`, and `agent`.                                         |
| 2025-12-31 12:11:13 UTC | hive-mind PR 1044 opened. The linked solution log shows native Claude execution with explicit model, verbose mode, and bypass permissions, which became one parity baseline. |
| 2026-05-01 05:38:26 UTC | hive-mind PR 1044 updated after rebasing onto newer hive-mind behavior and `agent-commander@0.4.3`.                                                                          |
| 2026-05-01 05:12:29 UTC | agent-commander issue 29 opened to track the public API gaps found while reviewing the hive-mind integration.                                                                |
| 2026-05-01 06:58:58 UTC | issue 29 updated with the case-study/data-collection requirement.                                                                                                            |
| 2026-05-01              | PR 32 implements the parity surface, tests, documentation, and release fragments.                                                                                            |

## Requirements Extracted

1. Claude callers need environment passthrough for thinking, context, compaction, MCP, and telemetry controls; raw arguments for MCP configs and permission modes; custom executable support; and a way to avoid agent-commander's default permission bypass when the caller supplies its own policy.
2. Codex callers need raw config passthrough for reasoning, context, auto-compaction, MCP, sandbox, approval, and prompt-file workflows; custom executable support; and suppressible default dangerous bypass flags.
3. OpenCode callers need raw config/permission environment parity, custom executable support, raw native arguments, and prompt-file support for large prompts.
4. `agent` callers need raw arguments/environment/executable passthrough for verbose, resume, config, and JSON-related native options where supported by that CLI.
5. JavaScript and Rust behavior should remain aligned.
6. Existing defaults and read-only behavior should keep working for callers that do not opt into the new passthrough options.
7. The issue artifacts and related logs should be stored under this case-study directory.

## Root Causes

- The JavaScript and Rust command builders used hard-coded executable names for the native CLIs.
- There was no public way to attach environment variables to only the native tool process. This mattered because `codex`, `opencode`, and `agent` use prompt pipelines, and caller-provided env must apply to the tool side rather than the `cat` or `printf` side.
- Raw native CLI arguments could not be appended, so fast-moving upstream options such as MCP config files, Codex config overrides, or Claude permission modes required new agent-commander releases.
- Claude and Codex builders always added autonomous default safety bypass flags unless read-only mode was selected. That blocked callers from supplying their own permission, sandbox, or approval policy.
- The CLI parser only kept one value for a repeated option and treated a value beginning with `--` as another flag, which would make raw argument passthrough unusable for native flags.
- Documentation described typed common options but not an escape hatch for native execution parity.

## Online Findings

- Claude Code documents many environment-variable controls, including variables for disabling thinking, MCP connection behavior, MCP startup timeouts, and MCP output-token limits. Its MCP docs also show environment and timeout configuration as first-class behavior.
- Codex documents `codex exec` for scripted runs, `--dangerously-bypass-approvals-and-sandbox`, prompt stdin support, and config keys such as `approval_policy`, `sandbox_mode`, and `mcp_servers.*`.
- OpenCode documents permission configuration, context compaction, MCP configuration, provider enable/disable behavior, and environment-variable substitution in config files.
- @link-assistant/agent documents OpenCode JSON compatibility and explicitly warns that it has no sandbox or permission system, so agent-commander should not pretend to enforce `--read-only` for that tool.

## Solution Implemented

- Added shared shell helpers for JavaScript and Rust command builders.
- Added `executable`, `extraEnv` / `extra_env`, and `extraArgs` / `extra_args` command-builder options for `claude`, `codex`, `opencode`, and `agent`.
- Added CLI passthrough flags: `--tool-executable`, repeatable `--tool-env KEY=VALUE`, repeatable `--tool-arg`, and `--skip-default-safety-flags`.
- Preserved repeated raw CLI arguments and allowed `--tool-arg --native-flag` values to start with `--`.
- Applied `extraEnv` on the native tool side of stdin pipelines, for example `cat prompt.txt | env CODEX_HOME=... codex exec ...`.
- Added `skipDefaultSafetyFlags` / `skip_default_safety_flags` so callers can replace default Claude/Codex bypass behavior with explicit native permission, sandbox, or approval options.
- Added direct builder support for Claude `permissionMode` and Codex `sandboxMode` / `approvalMode`.
- Kept existing read-only mappings intact and continued rejecting `agent` read-only mode because @link-assistant/agent has no enforceable permission system.

## Verification

Focused reproducing checks:

| Check                                                                      | Result                |
| -------------------------------------------------------------------------- | --------------------- |
| `node --test js/test/command-builder.test.mjs js/test/cli-parser.test.mjs` | Pass, 42 tests        |
| `cargo test raw_passthrough --manifest-path rust/Cargo.toml`               | Pass, 2 focused tests |

Full local checks:

| Check                                                                           | Result                            |
| ------------------------------------------------------------------------------- | --------------------------------- |
| `npm test` in `js/`                                                             | Pass, 167 tests                   |
| `npm run check` in `js/`                                                        | Pass, 0 errors; existing warnings |
| `bun test` in `js/`                                                             | Pass, 167 tests                   |
| `deno test --allow-read --allow-run --allow-env --allow-net test/**/*.test.mjs` | Pass, 166 passed, 1 ignored       |
| `cargo fmt --all -- --check` in `rust/`                                         | Pass                              |
| `cargo clippy --all-targets --all-features` in `rust/`                          | Pass                              |
| `node ../scripts/rust/check-file-size.mjs` in `rust/`                           | Pass                              |
| `cargo test --all-features --verbose` in `rust/`                                | Pass                              |
| `cargo test --doc --verbose` in `rust/`                                         | Pass                              |
| `cargo build --release --verbose` in `rust/`                                    | Pass                              |
| `cargo package --list --allow-dirty` in `rust/`                                 | Pass                              |

## Follow-Up Options

- Add first-class typed wrappers for specific upstream controls if hive-mind settles on stable names for Claude thinking/context settings, Codex config profiles, or OpenCode config files.
- Extend the same raw passthrough escape hatch to `qwen` and `gemini` if future hive-mind parity work needs it.
- Add a public helper for creating temporary native config files from structured objects instead of requiring callers to write those files themselves.
