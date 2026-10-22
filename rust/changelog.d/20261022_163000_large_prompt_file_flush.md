---
bump: patch
---

### Fixed

- Prompt files over 2 MiB are now fully written before the agent starts. tokio writes a file at most 2 MiB at a time, and `write_all` returned before the last write finished, so a tool could read a cut-off prompt.
