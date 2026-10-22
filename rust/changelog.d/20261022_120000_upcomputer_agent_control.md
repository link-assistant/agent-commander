---
bump: minor
---

### Added

- Launch options for upcomputer and Hive Mind (issue #57), mapped to native flags and rejected by tools without them:
  - `reasoning_effort`
  - `mcp_config` and `strict_mcp_config`
  - `additional_directories`
  - `attachments`
  - `json_schema`

  `launch_capabilities` and `check_launch_options_supported` report and enforce support.

- `usage_windows`, `context_usage` and `structured_output` in result metadata, with Codex rollout helpers (`apply_codex_rollout_usage_windows`, `codex_rollout_context_usage`).
- Live input for claude, qwen and agent: `send_message`, `interrupt`, `end_input`, and the frame builders.
- CLI version probe: `get_tool_version`, `parse_tool_version`, `compare_versions`, `build_version_command`.
- `ToolOverrides` replaces a tool's command builder, parser, session-id or usage extractor, executable or launch capabilities for one run, or drives an unregistered tool. `escape_arg` and `build_base_command` are exported for override builders.
