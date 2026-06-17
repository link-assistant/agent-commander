---
bump: minor
---

### Added

- Add a uniform per-command approval relay ("ask" mode). The new `--approve-each` flag (alias `--permission-mode ask`, `AgentOptions.approve_each`) maps to each backend's native per-command approval mechanism and relays native permission prompts as normalized `permission_request` events (carrying an opaque `id`, `tool`, `command`/`pattern`, `title`, and a `scope`), forwarding the consumer's normalized decision (`once` | `always` | `reject`) back in the native wire format. Supported (relayable) for `agent` (`--permission-mode ask` + `--input-format stream-json`, scope `session`) and `claude` (stream-json `can_use_tool`, scope `tool-input`); rejected with a clear error for `codex`, `qwen`, `gemini`, and `opencode`. Adds a `permissions` module (`normalize_permission_request`, `build_permission_response`, `PermissionRelay`, `permission_parity`, `supports_ask`, `ASK_DECISIONS`, `ask_scope`).
