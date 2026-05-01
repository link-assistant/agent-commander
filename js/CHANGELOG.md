# agent-commander

## 0.4.3

### Patch Changes

- f914440: ### Fixed
  - Pipe prompts for stdin-based tools through temporary prompt files during execution so large generated prompts are not embedded in nested shell commands.

  ### Added
  - Added `--prompt-file` / `promptFile` support for callers that already have prompt content on disk.

## 0.4.2

### Patch Changes

- 5ca235f: Add JavaScript package README metadata, language-specific GitHub Release tags, and cross-language release documentation.

## 0.4.1

### Patch Changes

- a310e7d: Expose a repository-root npm package manifest for GitHub dependency installs and align JavaScript release publishing with the dedicated js.yml workflow.

## 0.4.0

### Minor Changes

- 6d5f7fe: Sync model maps from hive-mind v1.57.2 (issue #22):
  - Claude: `opus` now resolves to `claude-opus-4-7` (was `claude-opus-4-6`); add `opus-4-7` and `claude-opus-4-7` aliases. `opus-4-6` retained for backward compatibility.
  - Codex: add `gpt-5.5` family (and `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1-codex-max`); default model changed from `gpt-5` to `gpt-5.5`.
  - Agent: add `nemotron-3-super-free` (NVIDIA hybrid Mamba-Transformer); default model changed from `minimax-m2.5-free` to `nemotron-3-super-free`; mark `qwen3.6-plus-free` as deprecated (kept for backward compatibility).

## 0.3.0

### Minor Changes

- 921bcd6: Add enforceable read-only planning mode for supported tools and reject unsupported tools.

## 0.2.0

### Minor Changes

- cca4668: Add Qwen Code CLI support
  - Added new `qwen` tool configuration for Qwen Code CLI (Alibaba's AI coding agent)
  - Supports stream-json output format for real-time NDJSON streaming
  - Supports auto-approval mode with `--yolo` flag (enabled by default)
  - Supports session management with `--resume` and `--continue` options
  - Supports context options like `--all-files` and `--include-directories`
  - Supports `--include-partial-messages` for real-time UI updates
  - Added model aliases: `qwen3-coder`, `coder`, `gpt-4o`
  - Added comprehensive tests for the new Qwen tool
