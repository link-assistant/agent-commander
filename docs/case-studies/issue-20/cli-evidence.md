# CLI Capability Evidence

This evidence combines local CLI help output captured during the investigation and online documentation checked on 2026-04-26.

## Local Help Findings

Captured help files were stored under `/tmp/gh-issue-solver-notes-1777224492990/cli-help/` during investigation.

| Tool | Local evidence | Read-only mapping |
|------|----------------|-------------------|
| Claude | `claude-help.txt` lists `--permission-mode <mode>` and includes `plan` as a choice. | `claude --permission-mode plan` |
| Codex | `codex-exec-help.txt` lists `--sandbox <SANDBOX_MODE>` with `read-only`; global help lists `--ask-for-approval <APPROVAL_POLICY>` with `never`. | `codex --ask-for-approval never exec --sandbox read-only` |
| OpenCode | `opencode-run-help.txt` did not expose a specific plan mode, but OpenCode supports permission config through environment/config. | `OPENCODE_PERMISSION='{"edit":"deny","bash":"deny","task":"deny"}' opencode run` |
| Gemini | `gemini-help.txt` lists `--approval-mode` with `plan`. | `gemini --approval-mode plan` |
| Qwen | `qwen-help.txt` lists `--approval-mode` with `plan`. | `qwen --approval-mode plan` |
| Agent | `agent-help.txt` has no permission or read-only mode. | unsupported; fail clearly |

## Online Documentation

- Claude Code permissions document `plan` as a permission mode where analysis is allowed but file modification and command execution are not: https://code.claude.com/docs/en/permissions
- Codex help center documents local CLI approval modes and points users to the official GitHub repo; exact current `exec` flags were verified from local CLI help: https://help.openai.com/en/articles/11096431-openai-codex-ci-getting-started
- OpenCode permissions support `allow`, `ask`, and `deny`, with permissions keyed by tools such as `edit`, `bash`, and `task`: https://opencode.ai/docs/permissions
- OpenCode CLI documents `OPENCODE_PERMISSION` as an inline JSON permissions config environment variable: https://opencode.ai/docs/cli/
- Qwen Code approval mode docs describe Plan mode as read-only analysis with no shell execution: https://qwenlm.github.io/qwen-code-docs/en/users/features/approval-mode/
- Gemini CLI plan mode docs describe plan mode for safe read-only exploration and planning: https://geminicli.com/docs/cli/plan-mode/

