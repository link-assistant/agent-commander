# Case Study: Publishable Packages and Release Workflows (Issue #19)

## Problem Statement

Issue #19 came from Hive Mind needing to depend on `agent-commander` for `/task` and `/split` flows. On 2026-04-26 there were two install blockers:

1. `agent-commander` and `@link-assistant/agent-commander` lookups returned npm `E404`.
2. `npm install github:link-assistant/agent-commander#v0.2.0` failed because the repository root had no `package.json`; the JavaScript package lived under `js/package.json`.

The npm package `agent-commander` has since been published, but GitHub dependency installs and release workflows still needed repository changes.

## Evidence Collected

- Issue and PR metadata: `github/issue-19.json`, `github/pr-24.json`, and related comment/review JSON files.
- Current CI run metadata and logs: `github/recent-runs.json`, `github/run-*.json`, and `ci-logs/*.log`.
- Original issue screenshot: `images/issue-19-npm-package.png` (validated PNG signature: `89 50 4e 47 0d 0a 1a 0a`).
- Reproduction log: `github/github-install-v0.2.0-before.log`.
- npm registry checks: `github/npm-agent-commander-view.json` and `github/npm-scoped-agent-commander-view.*`.
- Template comparison snapshots: `templates/*-template-file-tree.txt`, `templates/*-template-release.yml`, and selected publish helper scripts.

## Timeline

| Date       | Event                                                                                                                                           |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-04-26 | Issue #19 opened after Hive Mind dependency planning found npm registry `E404` results and GitHub install failure from a missing root manifest. |
| 2026-04-26 | `agent-commander` package was published on npm, resolving the unscoped registry lookup.                                                         |
| 2026-04-30 | PR #24 branch was prepared with only `.gitkeep`; branch CI passed for that initial commit.                                                      |
| 2026-04-30 | CI logs, issue metadata, npm registry data, the issue screenshot, and template snapshots were downloaded into this case-study folder.           |
| 2026-04-30 | The GitHub install failure was reproduced locally against tag `v0.2.0`; npm exited `254` with `ENOENT` for the cloned root `package.json`.      |
| 2026-04-30 | The fix added a root npm manifest, split CI/CD into `js.yml` and `rust.yml`, aligned publish scripts, and added tests.                          |
| 2026-04-30 | Fresh PR CI found Node 24 no longer accepts `node --test test/`; the npm script now enumerates `.test.mjs` files explicitly.                    |

## Requirements Extracted

1. Make the JavaScript package installable as documented by publishing to npm or exposing a root package manifest.
2. Preserve GitHub dependency install support for `github:link-assistant/agent-commander`.
3. Configure JavaScript publishing through the workflow filename registered with npm trusted publishing (`js.yml`).
4. Configure Rust publishing through a dedicated `rust.yml` workflow and organization-level Cargo token support.
5. Compare CI/CD workflow and script files against the JS and Rust pipeline templates.
6. Download and preserve issue-related logs, metadata, screenshots, and reproduction data under `docs/case-studies/issue-19`.
7. Reconstruct the timeline, requirements, root causes, solution options, and verification plan.
8. Report related template issues if a reusable template defect is found.

## Root Causes

### Missing Root npm Manifest

npm can install a GitHub repository dependency, but the repository root must describe an installable package. The previous repository root had no `package.json`, so npm cloned the ref and failed before it could see `js/package.json`.

### Trusted Publisher Workflow Mismatch

The issue states that npm trusted publishing was configured for `js.yml`, while this repository only had `.github/workflows/ci.yml`. npm trusted publishing binds to a specific workflow filename, so the JavaScript release job needed to live in `.github/workflows/js.yml`.

### Template Placeholder Left in Publish Script

`scripts/js/publish-to-npm.mjs` still used `PACKAGE_NAME = 'my-package'`. That means the release job would check and report the wrong npm package even though `js/package.json` was named `agent-commander`.

### Rust Release Fragility

The Rust release script expected `CHANGELOG.md` during `git add`, but `rust/CHANGELOG.md` did not exist. It also collected changelog fragments without removing them, which would allow the same fragments to be reused on later releases.

### Node 24 Test Directory Handling

The split JavaScript workflow runs Node 24. PR run `25144466715` and push run `25144465539` both failed in the Node test matrix because `node --test test/` attempted to load `js/test` as a module. The package test script now uses a small Node runner that enumerates `.test.mjs` files and passes explicit file paths to `node --test`, avoiding shell glob and Node-version differences.

## Solution Implemented

- Added a root `package.json` named `agent-commander` that exposes `./js/src/index.mjs` and the `start-agent` / `stop-agent` binaries from `js/bin`.
- Added `js/test/root-package.test.mjs` to verify the root manifest stays aligned with `js/package.json`.
- Updated the Node test script to enumerate explicit `.test.mjs` files instead of passing the `test/` directory for Node 24 CI compatibility.
- Updated JS release versioning to synchronize the root package version after changeset or instant bumps.
- Updated `scripts/js/publish-to-npm.mjs` to check and report `agent-commander`.
- Split the combined workflow into `.github/workflows/js.yml` and `.github/workflows/rust.yml`.
- Added npm trusted publishing prerequisites to JS release jobs: `id-token: write`, Node 24, registry URL, and npm upgrade step.
- Added Rust release token fallback through `CARGO_REGISTRY_TOKEN` and `CARGO_TOKEN`.
- Added `rust/CHANGELOG.md` and fixed Rust version collection to remove processed fragments.
- Updated README install instructions and repository layout documentation.
- Added a JavaScript changeset for the user-facing package install and release workflow fix.

## Template Comparison

The JS template confirmed these relevant best practices:

- Keep npm trusted publishing in the exact registered workflow file.
- Use `id-token: write` and a modern Node/npm pair for OIDC publishing.
- Run check, test, release, and manual release paths from one workflow file because npm allows only one trusted publisher connection per package.
- Detect changes before expensive jobs and keep release jobs gated to `main`.

The Rust template confirmed these relevant best practices:

- Support Cargo's native `CARGO_REGISTRY_TOKEN` while retaining `CARGO_TOKEN` compatibility.
- Build/package before release.
- Gate automatic release on successful lint, test, and build jobs.
- Keep manual changelog PR and instant release paths in the same dedicated Rust workflow.

The only reusable-template concern found was the JS template's `PACKAGE_NAME = 'my-package'` placeholder in `scripts/publish-to-npm.mjs`; this repository fixes it locally by setting `agent-commander`.

Template issue reported: https://github.com/link-foundation/js-ai-driven-development-pipeline-template/issues/42

## Alternatives Considered

- Only rely on the npm registry package: rejected because the issue explicitly cited GitHub dependency installs and requested root package/workspace support.
- Make the repository an npm workspace: rejected for now because the root and `js/` package would have the same package name. A small root manifest is enough for GitHub installs without changing local development.
- Keep the combined `ci.yml`: rejected because npm trusted publishing was configured for `js.yml`.
- Move JS sources from `js/` to root: rejected because it would create unnecessary churn across tests, examples, and release scripts.

## Verification Results

Local verification logs were saved under `github/`.

| Check                                                                      | Result |
| -------------------------------------------------------------------------- | ------ |
| `npm test` in `js/`                                                        | Pass   |
| `npx -y node@24 ../scripts/js/run-node-tests.mjs` in `js/`                 | Pass   |
| `npm run lint` in `js/`                                                    | Pass   |
| `npm run format:check` in `js/`                                            | Pass   |
| `npm run check:duplication` in `js/`                                       | Pass   |
| Root package tarball install and `import { agent } from 'agent-commander'` | Pass   |
| `node --check` for modified release/change-detection scripts               | Pass   |
| `cargo fmt --all -- --check` in `rust/`                                    | Pass   |
| `cargo clippy --all-targets --all-features` in `rust/`                     | Pass   |
| `cargo test --all-features --verbose` in `rust/`                           | Pass   |
| `cargo test --doc --verbose` in `rust/`                                    | Pass   |
| `cargo build --release --verbose` in `rust/`                               | Pass   |
| `cargo package --list --allow-dirty` in `rust/`                            | Pass   |
| `node ../scripts/rust/check-file-size.mjs` in `rust/`                      | Pass   |
| YAML parse for `.github/workflows/js.yml` and `rust.yml`                   | Pass   |
| `git diff --check`                                                         | Pass   |

PR CI should run the split `js.yml`, `rust.yml`, and existing e2e workflows after this branch is pushed.

## Online Sources

- npm install documentation: https://docs.npmjs.com/cli/v8/commands/npm-install/
- npm trusted publishing documentation: https://docs.npmjs.com/trusted-publishers/
- Cargo publish documentation: https://doc.rust-lang.org/cargo/commands/cargo-publish.html
