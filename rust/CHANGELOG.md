# Changelog

All notable changes to the Rust package will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

<!-- changelog-insert-here -->

## [0.2.7] - 2026-07-24

### Added

- Added enforceable read-only planning mode for supported tools and clear rejection for unsupported tools.

### Fixed

- Removed JavaScript command execution's dependency on runtime CDN imports, avoiding Deno CI failures when `esm.sh` is unavailable.

### Changed

- Synced model maps from hive-mind v1.57.2 (issue #22): Claude `opus` -> `claude-opus-4-7`; Codex default `gpt-5` -> `gpt-5.5` and added the `gpt-5.5/5.4/5.3/5.2/5.1` family; Agent default `minimax-m2.5-free` -> `nemotron-3-super-free` with `qwen3.6-plus-free` retained as deprecated.

### Added

- Added Rust package README metadata and language-specific GitHub Release tags.

### Fixed

- Fixed Rust CLI pass-through for Claude fallback, session, prompt append, verbose, and replay options.

### Fixed

- Pipe prompts for stdin-based tools through temporary prompt files during execution so large generated prompts are not embedded in nested shell commands.

### Added

- Added `--prompt-file` / `prompt_file` support for callers that already have prompt content on disk.

### Added

- Added native execution passthrough controls for Claude, Codex, OpenCode, and @link-assistant/agent, including custom executables, raw tool environment variables, raw tool arguments, and suppressible default safety bypass flags.

### Added

- Expose normalized result metadata on `AgentResult`, including success classification, session IDs, usage-limit details, summaries, cost estimates, stream token usage, sub-agent calls, and execution error information for `claude`, `codex`, `opencode`, and `agent`.
- Add `AgentResult::usage` for Rust parity with the JavaScript result shape.

### Fixed

- Fixed Rust release recovery when a GitHub release tag exists without a matching crates.io publication, and made Rust GitHub releases explicitly become the repository latest release.

### Fixed

- Added Qwen and Gemini prompt-file stdin handling plus native executable, environment, and raw argument passthrough parity.

### Added

- Map `--read-only` and `--plan-only` for the `agent` tool to its native `--permission-mode` (agent v0.24.0): `--read-only` → `readonly` and `--plan-only` → `plan`. The `agent` tool now supports enforceable read-only/planning mode instead of being rejected, and exposes typed `permission_mode` and `permission` (OpenCode-compatible JSON policy) passthrough options.

### Added

- Add a uniform per-command approval relay ("ask" mode). The new `--approve-each` flag (alias `--permission-mode ask`, `AgentOptions.approve_each`) maps to each backend's native per-command approval mechanism and relays native permission prompts as normalized `permission_request` events (carrying an opaque `id`, `tool`, `command`/`pattern`, `title`, and a `scope`), forwarding the consumer's normalized decision (`once` | `always` | `reject`) back in the native wire format. Supported (relayable) for `agent` (`--permission-mode ask` + `--input-format stream-json`, scope `session`) and `claude` (stream-json `can_use_tool`, scope `tool-input`); rejected with a clear error for `codex`, `qwen`, `gemini`, and `opencode`. Adds a `permissions` module (`normalize_permission_request`, `build_permission_response`, `PermissionRelay`, `permission_parity`, `supports_ask`, `ASK_DECISIONS`, `ask_scope`).

### Added

- Add real PTY-backed interactive agent capture with input, control-key, resize, unrolled transcripts, semantic events, and replay artifacts for Claude, Codex, OpenCode, Agent, Gemini, and Qwen.
