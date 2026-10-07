# Validation for issue #50

The fixtures exercise all six native event formats through agent-commander's public controllers without credentials or provider requests. Shared JSON expectations and catalogue snapshots are copied inside the Rust crate and checked for equality in JavaScript. This verifies the dependency boundary, including subprocess behavior; it does not claim live inference or provider billing certification.

## Reproduction before implementation

Initial JavaScript regressions failed model/default synchronization, native usage accounting, incomplete turns and shell quoting. The initial Rust suite failed all four reproductions, including a pipe deadlock: a finite child writes 128 KiB to stderr before stdout, and the old sequential reader exceeds the five-second test limit. See [JavaScript before](data/validation/js-before.log.txt) and [Rust before](data/validation/rust-before.log.txt).

Further consumer audits added failing cases before their fixes:

- [Parent/subagent and empty-stream audit](data/validation/js-audit-before.log.txt): five failures for parent usage/verdict, recovered errors, native subagent records and empty JSON success.
- [Resume and usage vocabulary audit](data/validation/js-resume-before.log.txt): four failures for nested cache/reasoning fields, alternate Qwen usage names, OpenCode session flags and Agent resume.
- [Gemini JSON audit](data/validation/js-last-audit-before.log.txt): the official single-JSON response/statistics shape did not produce the native summary/completion result.

Run the focused suites from the repository root:

```sh
node --test js/test/hive-mind-parity.test.mjs
cargo test --manifest-path rust/Cargo.toml --test hive_mind_parity_tests
```

The fixed suites pass 50 JavaScript tests and 12 Rust tests, with multiple native cases inside each Rust test. [JavaScript after](data/validation/js-after.log.txt) and [Rust after](data/validation/rust-after.log.txt) retain the results. Cancellation children have finite 30-second lifetimes and bounded test waits; the pipe probe has finite output. No experiment deliberately exhausts host memory or stack.

The final review added two failing reproductions per language for formatted Gemini JSON: [JavaScript before](data/validation/js-pretty-before.log.txt) and [Rust before](data/validation/rust-pretty-before.log.txt). Whole-object parsing now complements the JSONL parser, and controllers fall back to it when the stream parser has no records. Session identity, statistics and terminal completion remain based on stdout.

## Local checks

Run these commands in `js/`:

```sh
npm run check
npm test
bun test
deno test --no-lock --allow-read --allow-write --allow-env --allow-run test/
```

Results: JavaScript quality checks pass with zero lint errors; Node and Bun each pass 290 tests. Deno passes 284 tests and ignores the six existing platform/runtime-specific cases. Deno write permission is required by the public-controller temporary-file tests and is included in the package script and CI. Existing complexity warnings remain nonfatal under the repository's lint configuration.

Run these commands in `rust/`:

```sh
cargo fmt --all -- --check
node ../scripts/rust/check-file-size.mjs
RUSTFLAGS=-Dwarnings cargo clippy --all-targets --all-features
cargo test --all-features --verbose
cargo test --doc --verbose
cargo package --allow-dirty
```

All checks pass; the full Rust suite passes 284 tests. The package verifies successfully with its own fixtures included; no test includes a source file outside the published crate. Rust file sizes remain below 1,000 lines. Documentation tests currently contain zero cases. The full test output records each suite's counts.

Rust checks were repeated using `cargo +1.99.0` to match CI's stable toolchain, including Clippy with warnings denied, the full suite and package verification.

The actual dependency example also passes once for each tool:

```sh
node examples/hive-mind-dependency.mjs claude --fixture
node examples/hive-mind-dependency.mjs codex --fixture
node examples/hive-mind-dependency.mjs agent --fixture
node examples/hive-mind-dependency.mjs opencode --fixture
node examples/hive-mind-dependency.mjs qwen --fixture
node examples/hive-mind-dependency.mjs gemini --fixture
```

Omit `--fixture` to use an installed, authenticated native CLI. Model availability, provider prices and consumer recovery policy remain caller responsibilities.

## CI investigation and final verification

The prepared branch had two failed runs on `71cef7a837f92c834883ad3f65ad48afa20fd9d6`, before any implementation commit:

- [JavaScript run 37616272375](https://github.com/link-assistant/agent-commander/actions/runs/37616272375), created 2026-10-07 11:45:40 UTC: macOS Bun's renderer-options integration test exceeded its implicit 5,000 ms runner limit (log lines 2226–2227). The helper has a 30,000 ms capture limit; neighboring PTY/GIF tests already set a matching test budget. This test omitted that budget. Its native rendering budget is now consistent with the other capture tests; assertions and capture behavior are retained.
- [Rust run 37616254353](https://github.com/link-assistant/agent-commander/actions/runs/37616254353), created 2026-10-07 11:45:31 UTC: Clippy's new `assert_is_empty` lint was promoted to an error by `-Dwarnings` (lines 856–942). Six preexisting assertions in `src/cli_parser.rs` and `tests/lib_tests.rs` now compare against empty values, providing useful failure output without suppressing lint.

Both raw logs are preserved as gzip files in [data/validation](data/validation/), with an uncompressed [error index](data/validation/baseline-ci-errors.txt). All local check logs are also preserved there; decompress with `gzip -dc FILE.log.gz`. File hashes and source URLs are recorded in [the evidence index](data/evidence-index.json).

The implementation's [Rust run 37623571577](https://github.com/link-assistant/agent-commander/actions/runs/37623571577), created 2026-10-07 12:47:34 UTC on `e0254f8`, exposed three more preexisting `assert_is_empty` errors in `tests/permissions_tests.rs:231–233`. The completed lint job's [raw log](data/validation/rust-lint-37623571577.log.gz) records them at lines 488–530; its [error index](data/validation/implementation-ci-errors.txt) preserves the locations. Running Clippy locally with Rust 1.99 reproduced all three failures before changing the assertions ([reproduction log](data/validation/rust-ci-before.log.txt)). The assertions now use `assert_ne!` against the empty string, retaining the nonempty checks and showing actual values on failure. The earlier local Rust 1.98.1 did not enforce this new lint. macOS and Windows tests on the implementation commit had passed before this lint correction.

Delivery checks use `gh run list --repo link-assistant/agent-commander --branch issue-50-da2c3230ff68 --limit 5 --json databaseId,conclusion,createdAt,headSha`, compare each run's SHA with the pushed commit, and inspect any failing run's fresh logs. The current implementation checks and final commit status are linked in [PR #51](https://github.com/link-assistant/agent-commander/pull/51/checks). A passing older placeholder run is not evidence for the new implementation.

Before marking the PR ready, review its complete diff, verify `origin/main` is an ancestor of the branch, confirm the working tree is clean, and wait for final-head checks to pass. Minor release fragments prepare the next JavaScript and Rust releases without publishing from this branch.
