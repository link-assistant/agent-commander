# Case Study: Hard Read-only Planning Mode (Issue #20)

## Problem Statement

Hive Mind needs to split a user-created task into smaller GitHub issues. The model run should only inspect context and return a plan or JSON structure; the surrounding application should perform all GitHub mutations deterministically. `agent-commander` already had `start-agent` flags for tool, model, prompt, system prompt, and isolation, but it did not expose a hard no-shell/no-write mode.

Prompt instructions alone are not enforceable. The missing capability allowed a planning run to start with broader tool permissions than the caller intended.

## Timeline

| Date | Event |
|------|-------|
| 2026-04-26 17:28 UTC | Prepared PR branch CI ran and failed before this change. |
| 2026-04-26 17:30 UTC | CI logs were downloaded to `ci-logs/` for local investigation. |
| 2026-04-26 | Issue #20 requirements and Hive Mind #501 dependency were reviewed. |
| 2026-04-26 | Local CLI help and online docs were checked for native read-only/planning support. |
| 2026-04-26 | JS and Rust implementations were updated with `--read-only` / `--plan-only`, native mappings, unsupported-tool rejection, and tests. |

## Requirements

1. Add a `start-agent` flag for hard read-only planning mode.
2. Provide `--plan-only` as an alias or equivalent planning flag.
3. Map the mode to each tool's safest native restriction.
4. Reject tools that cannot enforce the restriction.
5. Preserve compatibility with `--isolation screen`.
6. Keep JavaScript and Rust implementations aligned.
7. Add tests that reproduce the missing behavior and verify the fix.
8. Investigate and document related CI failures and evidence.

## Root Causes

### Missing Permission Abstraction

The command builders only had an autonomous-execution stance. Claude always received `--dangerously-skip-permissions`, Codex always received `--dangerously-bypass-approvals-and-sandbox`, Qwen/Gemini defaulted toward `--yolo`, and OpenCode had no permission override. There was no cross-tool option representing "planning only".

### Unsupported Tool Ambiguity

The internal `agent` tool has no native permission system. Before this change there was no way for `start-agent` to fail when a caller requested restrictions the selected tool could not enforce.

### CLI Propagation Gaps

The JS `start-agent` parser already had several tool-specific options, but the CLI entrypoint passed only a subset into `agent()`. The Rust binary had a similar issue for model/resume/read-only propagation. This made adding a reliable flag require end-to-end propagation, not only command-builder changes.

### CI Fragility

The JS executor depended on a runtime import from `https://esm.sh/command-stream@latest`. Deno CI failed when that CDN returned HTTP 500. That was unrelated to read-only mode but blocked verification on the prepared PR branch.

## Solution

The implemented solution adds `readOnly` / `read_only` as an explicit option and maps it by tool:

| Tool | Mapping | Behavior |
|------|---------|----------|
| Claude | `--permission-mode plan` | Analyze without file edits or command execution. |
| Codex | `--ask-for-approval never exec --sandbox read-only` | Non-interactive read-only sandbox. |
| OpenCode | `OPENCODE_PERMISSION='{"edit":"deny","bash":"deny","task":"deny"}'` | Blocks file edits, shell commands, and subagent launches. |
| Qwen | `--approval-mode plan` | Plan mode for read-only analysis. |
| Gemini | `--approval-mode plan` | Plan mode for read-only exploration. |
| Agent | unsupported | Fails before launching. |

The same mode is passed before the isolation wrapper, so screen isolation wraps the already-restricted command.

## Alternatives Considered

- Prompt-only instructions: rejected because the issue explicitly requires enforceable restrictions.
- A generic `--disable-tools shell,bash,write`: deferred because each CLI exposes different native permission surfaces. A typed read-only mode is simpler and safer for the current workflow.
- Supporting `agent` by prompt instruction: rejected because it would silently run with broader permissions than requested.
- Only documenting current tool flags: rejected because Hive Mind needs a stable `start-agent` contract.

## Verification Strategy

Tests now cover:

- `--read-only` parsing in JS and Rust.
- `--plan-only` alias parsing in JS and Rust.
- Claude plan mode without dangerous permission bypass.
- Codex read-only sandbox without dangerous bypass.
- OpenCode denied `edit`, `bash`, and `task` permissions.
- Screen isolation preserving read-only command flags.
- Clear failure for unsupported `agent` read-only mode.

The CI root cause and fix are documented in [ci-summary.md](ci-summary.md).

## Sources

- Issue #20: https://github.com/link-assistant/agent-commander/issues/20
- Hive Mind #501: https://github.com/link-assistant/hive-mind/issues/501
- Claude Code permissions: https://code.claude.com/docs/en/permissions
- Codex CLI help center: https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started
- OpenCode permissions: https://opencode.ai/docs/permissions
- OpenCode CLI environment variables: https://opencode.ai/docs/cli/
- Qwen approval mode: https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/
- Gemini plan mode: https://geminicli.com/docs/cli/plan-mode/

