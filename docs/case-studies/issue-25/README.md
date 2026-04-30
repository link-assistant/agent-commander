# Case Study: CI/CD and Multilingual Package Documentation (Issue #25)

## Problem Statement

Issue #25 asked for an additive cleanup of the multilingual release and documentation flow for `agent-commander`.

The repository already had separate JavaScript and Rust packages, but several release-facing details were still ambiguous:

1. Root `README.md` had no npm or crates.io package version badges.
2. GitHub Releases used undifferentiated `vX.Y.Z` tags and names, which cannot distinguish JavaScript and Rust releases from the same repository.
3. The JavaScript package and Rust crate did not each have their own package-root README.
4. Rust parsed several Claude-specific CLI options but did not pass them through to command construction.
5. Rust did not track `Cargo.lock` even though the workflow cache and the Rust CI/CD template expect it.
6. Cross-language docs and tests did not explicitly guard package metadata parity.

## Evidence Collected

- Issue metadata: `data/issue-25.json`
- Issue comments: `data/issue-25-comments.json`
- PR metadata: `data/pr-26.json`
- Initial branch CI runs: `data/recent-runs.json`
- npm registry state: `data/npm-agent-commander.json`
- crates.io registry state: `data/crates-agent-commander.json`
- Template file trees: `templates/js-template-file-tree.txt` and `templates/rust-template-file-tree.txt`
- Local verification logs: `verification/*.log`

Registry checks on 2026-04-30 showed `agent-commander` published as npm `0.4.1` and crates.io `0.1.0`.

## Requirements Extracted

1. Add visible package version badges for JavaScript and Rust in repository and package documentation.
2. Create language-specific GitHub Releases with `[JavaScript]` and `[Rust]` names and `js_` / `rust_` tag prefixes.
3. Add `js/README.md` and `rust/README.md`, and make sure each package includes its README.
4. Preserve common documentation for shared concepts while keeping language-specific details in package READMEs.
5. Keep JavaScript and Rust tests aligned for shared behavior where practical.
6. Keep changes additive; do not remove existing documented behavior.
7. Compare the current tree with the JavaScript and Rust CI/CD templates and apply relevant best practices.

## Root Causes

### Shared Release Tags

Both release scripts generated `v${version}` tags and release names. That works for a single package, but it is ambiguous when npm and crates.io releases come from the same repository.

### Missing Package READMEs

The root README documented the project, but package registries need README content in each publish root. npm package contents were missing `js/README.md`; Cargo had no explicit `readme = "README.md"` and no `rust/README.md`.

### Rust CLI Option Drop

`rust/src/cli_parser.rs` already parsed `--append-system-prompt`, `--fallback-model`, `--session-id`, `--fork-session`, `--verbose`, and `--replay-user-messages`. The values were not present on `AgentOptions` / `AgentCommandOptions`, so they were discarded before reaching `ClaudeBuildOptions`.

### Lockfile Mismatch

The Rust workflow caches by `rust/Cargo.lock`, and the Rust template commits `Cargo.lock`, but `rust/.gitignore` ignored it. This made the cache key unstable and prevented the crate package metadata from matching the template.

## Template Comparison

The JavaScript template confirmed these relevant practices:

- Keep Changesets metadata and package release notes in the package root.
- Keep release metadata deterministic and covered by tests.
- Publish language-specific GitHub Releases instead of relying on a single repository version namespace.
- Include package-facing documentation in the npm package.

The Rust template confirmed these relevant practices:

- Keep a dedicated Rust README and changelog fragment flow.
- Commit `Cargo.lock` for binary-producing crates and CI cache stability.
- Build/package before release and validate package contents.
- Keep release tags language-specific when a repository has more than one package ecosystem.

No reusable template defect was found that required opening a template issue.

## Online Sources

- npm `files` and always-included README behavior: https://docs.npmjs.com/cli/v10/configuring-npm/package-json/#files
- Cargo `readme` manifest field: https://doc.rust-lang.org/cargo/reference/manifest.html#the-readme-field
- GitHub Release API `tag_name`, `name`, and `body` fields: https://docs.github.com/en/rest/releases/releases?apiVersion=2022-11-28#create-a-release
- Shields.io npm version badges: https://shields.io/badges/npm-version
- Shields.io crates.io version badges: https://shields.io/badges/crates-io-version
- Changesets workflow overview: https://github.com/changesets/changesets/blob/main/docs/intro-to-using-changesets.md

## Solution Implemented

- Added npm, crates.io, JavaScript CI, and Rust CI badges to the root README.
- Added `js/README.md` and `rust/README.md` with language-specific installation, CLI, library, release, and test documentation.
- Added `docs/common-concepts.md` for shared tool, isolation, read-only, Claude-option, and release semantics.
- Added `scripts/shared/release-metadata.mjs` to generate release tags, names, package version badges, and release bodies consistently.
- Updated JavaScript releases to use `js_X.Y.Z` tags and `[JavaScript] vX.Y.Z` names.
- Updated Rust releases and Rust release tag creation to use `rust_X.Y.Z` tags and `[Rust] vX.Y.Z` names.
- Added release metadata tests for JavaScript and Rust release bodies.
- Added JavaScript and Rust package metadata tests for README packaging.
- Passed Rust Claude-specific CLI options through `AgentOptions`, `AgentCommandOptions`, and the `start-agent` binary.
- Added Rust tests mirroring JavaScript CLI parsing and start/stop behavior.
- Stopped ignoring `rust/Cargo.lock` and added it to package metadata checks.
- Added a JavaScript changeset and Rust changelog fragment for the user-facing release/doc fixes.

## Reproduction Tests

Before the fix, the new package metadata tests failed:

| Check                                             | Before                                 |
| ------------------------------------------------- | -------------------------------------- |
| `node --test js/test/package-readme.test.mjs`     | Failed: `js/README.md` did not exist   |
| `cargo test rust_crate_declares_and_ships_readme` | Failed: `rust/README.md` did not exist |

After the fix, both checks pass.

## Verification Results

| Check                                                                           | Result                                      | Log                                           |
| ------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------- |
| `node --test js/test/package-readme.test.mjs js/test/release-metadata.test.mjs` | Pass                                        | `verification/js-focused-tests.log`           |
| `npm test` in `js/`                                                             | Pass, 160 tests                             | `verification/npm-test.log`                   |
| `bun test` in `js/`                                                             | Pass, 160 tests                             | `verification/bun-test.log`                   |
| `deno test --allow-read --allow-run --allow-env --allow-net test/**/*.test.mjs` | Pass, 160 tests                             | `verification/deno-test.log`                  |
| `npm run check` in `js/`                                                        | Pass with existing warnings only            | `verification/npm-check.log`                  |
| `npm pack --dry-run` in `js/`                                                   | Pass, includes `README.md`                  | `verification/npm-pack-dry-run.log`           |
| `cargo fmt --all -- --check` in `rust/`                                         | Pass                                        | `verification/cargo-fmt.log`                  |
| `cargo clippy --all-targets --all-features` in `rust/`                          | Pass                                        | `verification/cargo-clippy.log`               |
| `cargo test --all-features --verbose` in `rust/`                                | Pass                                        | `verification/cargo-test.log`                 |
| `cargo package --list --allow-dirty` in `rust/`                                 | Pass, includes `README.md` and `Cargo.lock` | `verification/cargo-package-list.log`         |
| `cargo test rust_crate_declares_and_ships_readme`                               | Pass                                        | `verification/rust-package-metadata-test.log` |

The initial branch CI runs for SHA `b30d2eff9221512680c7358c14c0153095b26252` were already passing before this implementation. Fresh CI must be checked again after pushing this branch.
