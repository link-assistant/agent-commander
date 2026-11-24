---
bump: minor
---

### Security

- `extra_env` values are passed through the child environment (`Command::envs`) instead of `env KEY=value` on the command line, which other local users can read with `ps` or `/proc/<pid>/cmdline` (issue #60). `unset_env` is applied the same way. Docker isolation forwards the variables by name with `-e NAME`.
- The Claude `system_prompt` and `append_system_prompt` are written to owner-only (0600) temporary files and passed with `--system-prompt-file` and `--append-system-prompt-file`. The TUI driver does the same for `--append-system-prompt-file`.
- `launch.json_schema` is written to a temporary file:
  - Codex reads it with `--output-schema <file>`.
  - Qwen reads it with `--json-schema @<file>`.
  - Claude receives it as `--json-schema "$(cat <file>)"`. It is still one argument, so it must stay under Linux's 128 KiB per-argument limit.

### Added

- `AgentOptions::inherit_env`: `InheritEnv::All` (default), `None` or `Only(names)`, an allowlist of host variables the tool inherits.
- `AgentOptions::env`: an explicit environment that replaces the inherited one.
- `build_child_environment`, `file_content_arg`, `start_command_with_env` and `execute_detached_with_env`.
