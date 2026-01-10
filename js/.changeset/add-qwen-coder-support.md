---
"agent-commander": minor
---

Add Qwen Code CLI support

- Added new `qwen` tool configuration for Qwen Code CLI (Alibaba's AI coding agent)
- Supports stream-json output format for real-time NDJSON streaming
- Supports auto-approval mode with `--yolo` flag (enabled by default)
- Supports session management with `--resume` and `--continue` options
- Supports context options like `--all-files` and `--include-directories`
- Supports `--include-partial-messages` for real-time UI updates
- Added model aliases: `qwen3-coder`, `coder`, `gpt-4o`
- Added comprehensive tests for the new Qwen tool
