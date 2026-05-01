---
bump: minor
---

### Added

- Expose normalized result metadata on `AgentResult`, including success classification, session IDs, usage-limit details, summaries, cost estimates, stream token usage, sub-agent calls, and execution error information for `claude`, `codex`, `opencode`, and `agent`.
- Add `AgentResult::usage` for Rust parity with the JavaScript result shape.
