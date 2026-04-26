---
bump: minor
---

### Added
- Added enforceable read-only planning mode for supported tools and clear rejection for unsupported tools.

### Fixed
- Removed JavaScript command execution's dependency on runtime CDN imports, avoiding Deno CI failures when `esm.sh` is unavailable.

