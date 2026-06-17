---
bump: minor
---

### Added

- Map `--read-only` and `--plan-only` for the `agent` tool to its native `--permission-mode` (agent v0.24.0): `--read-only` → `readonly` and `--plan-only` → `plan`. The `agent` tool now supports enforceable read-only/planning mode instead of being rejected, and exposes typed `permission_mode` and `permission` (OpenCode-compatible JSON policy) passthrough options.
