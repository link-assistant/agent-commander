# Issue 35 Case Study: Qwen and Gemini Prompt-File Passthrough Parity

Issue: https://github.com/link-assistant/agent-commander/issues/35
PR: https://github.com/link-assistant/agent-commander/pull/36
Investigation date: 2026-05-01 UTC

## Problem Statement

`agent-commander@0.6.0` supported `qwen` and `gemini` as launch targets, but their command builders lagged behind `claude`, `codex`, `opencode`, and `agent` in two integration-critical areas:

1. They were excluded from automatic temporary prompt-file handling, so large hive-mind prompts were still emitted as shell/CLI arguments.
2. They hardcoded the native executable names and ignored raw passthrough options for executable overrides, environment variables, and native CLI arguments.

The expected outcome was parity where possible, or explicit documentation if parity was not possible. The investigation found the native CLIs can receive prompt content through stdin/piped input, so implementation was the correct path.

## Evidence Collected

- Issue metadata, comments, and timeline: `data/issue-35.json`, `data/issue-35-comments.json`, `data/issue-35-timeline.json`
- Prepared PR metadata, comments, reviews, initial diff, and initial CI runs: `data/pr-36*.json`, `data/pr-36-initial.diff`
- Related hive-mind integration context: `data/hive-mind-issue-1043*.json`, `data/hive-mind-pr-1044*.json`, `data/hive-mind-pr-1044.diff`
- Local code snapshots from `gh search code`: `data/main-js-qwen-content.json`, `data/main-js-gemini-content.json`
- Link-assistant code searches: `data/link-assistant-code-search-qwen-gemini.txt`, `data/link-assistant-code-search-use-agent-commander.txt` (both searches returned no rows)
- Existing case-study tree inventory: `data/existing-case-study-file-tree.txt`
- Local reproduction and verification logs: `verification/*.log`

## Timeline

- 2025-12-31 11:45:09 UTC: hive-mind issue #1043 was opened to add an agent-commander execution option.
- 2025-12-31 12:11:13 UTC: hive-mind PR #1044 was opened for experimental agent-commander execution.
- 2026-05-01 11:27:39 UTC: agent-commander issue #35 was opened for qwen/gemini prompt-file and passthrough parity.
- 2026-05-01 11:59:37 UTC: the issue received the case-study data collection requirement.
- 2026-05-01 12:00:48 UTC: draft PR #36 was prepared from branch `issue-35-02ed5d9c0295`.
- 2026-05-01 12:00:44-12:00:51 UTC: initial JS and Rust CI runs for the placeholder branch completed successfully at SHA `830cb40c5c3c4ce98705109ef2dd612d41bd1738`.

## Requirements Extracted

1. Add `promptFile` and automatic temporary prompt-file support for `qwen` and `gemini`.
2. Ensure large prompt handling combines `systemPrompt` and `prompt` into the temporary file for qwen/gemini instead of emitting them inline.
3. Add raw passthrough parity for qwen/gemini: executable override, extra environment variables, and extra native CLI arguments.
4. Keep default autonomous behavior unchanged, while allowing `--skip-default-safety-flags` to suppress qwen/gemini default `--yolo`.
5. Implement the behavior in both JavaScript and Rust.
6. Add failing regression tests before the fix and passing verification after the fix.
7. Update README documentation and release fragments.
8. Preserve issue, PR, and related hive-mind evidence in this case-study directory.

## Root Causes

### Prompt-File Allowlist Drift

The JavaScript and Rust high-level controllers used an explicit allowlist for tools that can read prompt content from stdin. That list included `claude`, `codex`, `opencode`, and `agent`, but omitted `qwen` and `gemini`. As a result, large prompts for qwen/gemini were still sent through `-p` shell arguments.

### Builder Duplication

The qwen and gemini command builders had local shell escaping functions and hardcoded `qwen` / `gemini` executable strings. They did not use the shared shell helpers that already normalize raw args, environment variables, executable overrides, and command heads for other tools.

### Rust Command-Builder Mapping Gap

Rust `AgentCommandOptions` already had `prompt_file`, `executable`, `extra_env`, `extra_args`, and `skip_default_safety_flags`, but the `gemini` and `qwen` match arms did not pass those fields into tool-specific build options.

### Documentation Lag

The README files documented `--tool-executable` and automatic prompt-file handling as available only for the earlier stdin-capable tools, so callers could not rely on qwen/gemini parity even if it were implemented.

## Online Sources

- Qwen Code repository and CLI README: https://github.com/QwenLM/qwen-code
- Gemini CLI headless/non-interactive documentation: https://google-gemini.github.io/gemini-cli/docs/cli/headless.html
- GitHub REST issue timeline API used for issue event evidence: https://docs.github.com/en/rest/issues/timeline
- GitHub Actions workflow run APIs used for CI run evidence: https://docs.github.com/en/rest/actions/workflow-runs

## Components And Libraries

- Existing JavaScript shell helpers in `js/src/tools/shell.mjs`: `buildCommandHead`, `escapeArg`, `normalizeExtraArgs`, and `normalizeExtraEnv`.
- Existing Rust shell helpers in `rust/src/tools/shell.rs`: `build_command_head` and `escape_arg`.
- Native stdin/piped prompt support in qwen/gemini-style CLIs, matching the existing agent-commander pattern for large prompt input.
- GitHub CLI plus GitHub REST API for collecting issue, PR, timeline, and workflow evidence.

## Options Considered

1. Document qwen/gemini as unsupported for prompt files and passthrough.
   This would satisfy the issue's fallback clause, but it would leave hive-mind with fragile large prompt execution even though the native CLIs can consume stdin.

2. Keep prompt content inline and only add raw executable/env/args passthrough.
   This would solve wrapper customization but not the core large-prompt failure mode.

3. Add qwen/gemini to the prompt-file path and refactor builders onto shared shell helpers.
   This was selected because it reuses proven local abstractions, keeps existing default behavior, and aligns JS and Rust behavior.

## Solution Implemented

- Added `qwen` and `gemini` to JavaScript and Rust prompt-file support allowlists.
- Updated JavaScript qwen/gemini builders to:
  - pipe `promptFile` through `cat ... | <tool>`;
  - suppress inline `prompt` and `systemPrompt` when `promptFile` is present;
  - use shared shell helpers for executable overrides, env vars, argument escaping, and raw args;
  - append `extraArgs` after typed args;
  - honor `skipDefaultSafetyFlags` for default `--yolo`.
- Updated Rust qwen/gemini build options and builders with the same prompt-file and passthrough behavior.
- Updated Rust `command_builder` to pass generic fields through to qwen/gemini.
- Added JavaScript and Rust tests for command builders, tool builders, and high-level large prompt temp-file behavior.
- Updated root, JavaScript, and Rust README documentation plus JS/Rust release fragments.

No new external issue was opened. The missing behavior is in this repository, and the relevant external CLIs already support stdin-style prompt input.

## Reproduction Tests

Before implementation, the new JavaScript tests failed because qwen/gemini command builders ignored `promptFile` and passthrough fields:

| Check                                                                               | Before result                                                                                                    | Log                                             |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `node --test test/command-builder.test.mjs test/tools.test.mjs test/index.test.mjs` | Failed as expected. qwen/gemini commands did not include `cat` prompt-file piping and did not apply passthrough. | `verification/js-qwen-gemini-parity-before.log` |

Before implementation, the new Rust tests failed at compile time because `QwenBuildOptions` and `GeminiBuildOptions` did not expose prompt-file and passthrough fields:

| Check                                                                                               | Before result                                                                                                                   | Log                                               |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------- |
| `cargo test --manifest-path rust/Cargo.toml --test qwen_tests --test gemini_tests --test lib_tests` | Failed as expected with missing `prompt_file`, `executable`, `extra_env`, `extra_args`, and `skip_default_safety_flags` fields. | `verification/rust-qwen-gemini-parity-before.log` |

## Verification Results

| Check                                                                                               | Result                                                  | Log                                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------- | ------------------------------------------------ |
| `node --test test/command-builder.test.mjs test/tools.test.mjs test/index.test.mjs`                 | Pass, 129 assertions/subtests                           | `verification/js-qwen-gemini-parity-after.log`   |
| `cargo test --manifest-path rust/Cargo.toml --test qwen_tests --test gemini_tests --test lib_tests` | Pass, qwen/gemini/lib targeted suites                   | `verification/rust-qwen-gemini-parity-after.log` |
| `npm test`                                                                                          | Pass                                                    | `verification/npm-test.log`                      |
| `npm run check`                                                                                     | Pass, with existing complexity warnings and zero errors | `verification/npm-check.log`                     |
| `cargo fmt --all -- --check`                                                                        | Pass                                                    | `verification/cargo-fmt-check.log`               |
| `cargo clippy --all-targets --all-features`                                                         | Pass                                                    | `verification/cargo-clippy.log`                  |
| `cargo test --all-features --verbose`                                                               | Pass                                                    | `verification/cargo-test.log`                    |
| `cargo test --doc --verbose`                                                                        | Pass                                                    | `verification/cargo-doc-test.log`                |
| `node ../scripts/rust/check-file-size.mjs`                                                          | Pass                                                    | `verification/rust-file-size.log`                |
