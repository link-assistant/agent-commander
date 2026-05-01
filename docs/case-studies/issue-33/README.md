# Issue 33 Case Study: Rust Release Not Latest

Issue: https://github.com/link-assistant/agent-commander/issues/33
PR: https://github.com/link-assistant/agent-commander/pull/34
Investigation date: 2026-05-01 UTC

## Requirement

Fix the CI/CD state where the repository has no latest Rust GitHub release. Compare the repository workflows with the JavaScript and Rust pipeline templates, preserve CI/release evidence under this directory, identify root causes, and implement a reproducible fix.

## Evidence Collected

- GitHub Release summaries: `data/releases-summary.json`
- Current `/releases/latest` response: `data/releases-latest.json`
- Full release list: `data/releases.json`
- Git tag list: `data/tags.json`
- crates.io package response: `data/crates-agent-commander.json`
- npm package response: `data/npm-agent-commander.json`
- CI logs: `ci-logs/*.log`
- Template snapshots: `templates/*`

## Timeline

- 2026-04-30 04:26:48 UTC: `js_0.4.2` and `rust_0.2.0` tags were created at the same commit SHA, `794af28b21a439f6994872665ded2a59db8c1e01`.
- 2026-04-30 04:27:34 UTC: Rust CI tried to publish `agent-commander@0.1.0`; Cargo reported that the crate already exists, but the workflow still logged success.
- 2026-04-30 04:27:36 UTC: GitHub Release `rust_0.2.0` was created, even though crates.io still only had `agent-commander@0.1.0`.
- 2026-05-01 09:09:00 UTC: JavaScript Release `js_0.5.0` was published and became the repository-wide GitHub latest release.
- 2026-05-01 09:09:23 UTC: Rust CI again found `Tag rust_0.2.0 already exists`.
- 2026-05-01 09:09:42 UTC: Rust CI again attempted to publish `agent-commander@0.1.0`; Cargo reported that it already exists, but the workflow logged success.
- 2026-05-01 09:09:44 UTC: Rust CI attempted to create `rust_0.2.0` again; GitHub returned `already_exists`, but the script still printed that the release was created.

## Root Causes

1. GitHub's latest release marker is repository-wide, not language-specific. The GitHub REST API supports `make_latest` on release creation, but the repository release scripts did not set it, so each successful JavaScript release could replace the latest Rust release.

2. Rust release checks used git tags as the source of truth. A tag can exist without a crate being published, and `rust_0.2.0` existed while crates.io still reported only `0.1.0`.

3. The Rust version script treated an existing `rust_0.2.0` tag as an already completed release. It then skipped the Cargo.toml update, leaving the package version at `0.1.0`.

4. The Rust publish step ran `cargo publish ... | tee publish_output.txt` without `pipefail`. The shell captured `tee`'s success exit code instead of `cargo publish`'s failure, so the workflow continued after Cargo reported that `0.1.0` already existed.

5. The Rust GitHub release script did not reliably fail on `gh api` errors. In the failing logs, GitHub returned HTTP 422 `already_exists`, but the script still printed a created-release message.

## Template Comparison

The Rust template already contains the important recovery pattern missing here: it checks crates.io as the release source of truth and publishes through a command wrapper that preserves the Cargo exit status. This repository had drifted from that behavior.

The JavaScript and Rust templates do not show the same exact failure, because they are single-language pipeline templates. They also do not need to coordinate a shared repository-wide latest release marker. No template issue was filed for the stale Rust tag and masked Cargo failure because those were repository integration bugs, not template bugs.

## Fix Implemented

- Added `scripts/rust/check-release-needed.mjs` so Rust release decisions use crates.io instead of git tags.
- Added `scripts/rust/release-registry.mjs` with tested version selection. It computes the requested bump, then skips any version already published to crates.io or already present as a `rust_*` tag. With the current state, a minor Rust release from `0.1.0` skips stale `rust_0.2.0` and selects `0.2.1`.
- Updated the Rust release workflow to call the crates.io check script and set `pipefail` around `cargo publish | tee`.
- Updated language release metadata so JavaScript releases send `make_latest: "false"` and Rust releases send `make_latest: "true"` to GitHub.
- Updated GitHub release creation scripts to inspect `gh api` exit codes and update already-existing releases instead of falsely logging success.
- Added tests for Rust version selection and language-specific latest policy.

## External References

- GitHub REST API: create a release, including `make_latest`: https://docs.github.com/rest/releases/releases#create-a-release
- GitHub REST API: get the latest release: https://docs.github.com/rest/releases/releases#get-the-latest-release
