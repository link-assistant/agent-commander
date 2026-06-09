---
'agent-commander': patch
---

Fix `metadata.success=false` / `metadata.limitReached=true` false positives on successful Claude runs. The usage-limit detector no longer matches the bare `ratelimit` substring inside Anthropic HTTP header names (e.g. `anthropic-ratelimit-unified-5h-reset`) emitted in `--output-format stream-json`, and now trusts an explicit structured `result` success message over the raw-text scan.
