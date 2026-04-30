# Shared Concepts

`agent-commander` has JavaScript and Rust implementations. The packages should keep the same user-facing behavior for common agent orchestration concepts, even when language-specific APIs differ.

## Tools

Both packages support these tool names:

| Tool       | Purpose                   | Read-only mode           |
| ---------- | ------------------------- | ------------------------ |
| `claude`   | Anthropic Claude Code CLI | `--permission-mode plan` |
| `codex`    | OpenAI Codex CLI          | `--sandbox read-only`    |
| `opencode` | OpenCode CLI              | permission deny rules    |
| `qwen`     | Qwen Code CLI             | `--approval-mode plan`   |
| `gemini`   | Gemini CLI                | `--approval-mode plan`   |
| `agent`    | @link-assistant/agent     | not enforceable          |

Unsupported tools can still be executed through the generic command builder, but read-only planning mode is rejected unless the tool has an enforceable native restriction.

## Isolation

The shared isolation modes are:

- `none`: run the command directly in the working directory.
- `screen`: wrap the command in a named GNU Screen session.
- `docker`: run the command in a container with the working directory mounted.

`--dry-run` should print the command that would be executed without starting a process.

## Claude Options

Both packages expose Claude-specific options for model fallback, session management, prompt appending, verbose mode, and replaying user messages:

- `appendSystemPrompt` / `append_system_prompt`
- `fallbackModel` / `fallback_model`
- `sessionId` / `session_id`
- `forkSession` / `fork_session`
- `verbose`
- `replayUserMessages` / `replay_user_messages`

The CLI spellings are kebab-case: `--append-system-prompt`, `--fallback-model`, `--session-id`, `--fork-session`, `--verbose`, and `--replay-user-messages`.

## Releases

The repository publishes separate language packages from one codebase:

- JavaScript releases use Changesets, npm, `js_` tags, and `[JavaScript] vX.Y.Z` release names.
- Rust releases use changelog fragments, crates.io, `rust_` tags, and `[Rust] vX.Y.Z` release names.

Root documentation should link to the language README files. Package README files should include registry version badges so npm and crates.io package pages show the current package status.
