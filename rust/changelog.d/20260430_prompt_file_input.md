---
bump: patch
---

### Fixed

- Pipe prompts for stdin-based tools through temporary prompt files during execution so large generated prompts are not embedded in nested shell commands.

### Added

- Added `--prompt-file` / `prompt_file` support for callers that already have prompt content on disk.
