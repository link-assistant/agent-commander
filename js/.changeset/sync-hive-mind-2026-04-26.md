---
'agent-commander': minor
---

Sync model maps from hive-mind v1.57.2 (issue #22):

- Claude: `opus` now resolves to `claude-opus-4-7` (was `claude-opus-4-6`); add `opus-4-7` and `claude-opus-4-7` aliases. `opus-4-6` retained for backward compatibility.
- Codex: add `gpt-5.5` family (and `gpt-5.4`, `gpt-5.3-codex`, `gpt-5.3-codex-spark`, `gpt-5.2`, `gpt-5.2-codex`, `gpt-5.1-codex-max`); default model changed from `gpt-5` to `gpt-5.5`.
- Agent: add `nemotron-3-super-free` (NVIDIA hybrid Mamba-Transformer); default model changed from `minimax-m2.5-free` to `nemotron-3-super-free`; mark `qwen3.6-plus-free` as deprecated (kept for backward compatibility).
