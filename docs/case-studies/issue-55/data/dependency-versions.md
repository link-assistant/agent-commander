# Dependency versions for issue #55

Checked on 2026-10-21 against the npm registry (`npm view <pkg> version engines`),
crates.io (`https://crates.io/api/v1/crates/<name>` with a User-Agent header), GitHub releases
(`gh release list` / `gh api repos/<owner>/<repo>/releases/latest`), and the pre-commit hook
repositories.

"Before" means the state at `95b1903` (initial commit). "Branch" means the current branch after
`62a4a1a` (JS devDeps) and `fbf2222` (Rust crates).

## npm (js/package.json)

| Package | Before | Branch | Latest | Engines (latest) | Major bump? |
| --- | --- | --- | --- | --- | --- |
| command-stream (dep) | ^2.4.0 | ^2.4.0 | 2.4.0 | node >=22.0.0, bun >=1.0.0 | no |
| @changesets/cli | ^2.29.7 | ^3.0.3 | 3.0.3 | node ^22.11 \|\| ^24 \|\| >=26 | **yes (2 -> 3)** |
| @eslint/js | ^9.35.0 | ^10.0.1 | 10.0.1 | node ^20.19 \|\| ^22.13 \|\| >=24 | **yes (9 -> 10)** |
| eslint | ^9.35.0 | ^10.13.0 | 10.13.0 | node ^20.19 \|\| ^22.13 \|\| >=24 | **yes (9 -> 10)** |
| eslint-config-prettier | ^10.1.8 | ^10.1.8 | 10.1.8 | - | no |
| eslint-plugin-prettier | ^5.5.4 | ^5.5.7 | 5.5.7 | - | no |
| husky | ^9.1.7 | ^9.1.7 | 9.1.7 | node >=18 | no |
| jscpd | ^4.0.5 | ^5.4.2 | 5.4.2 | node >=18 | **yes (4 -> 5)** |
| lint-staged | ^16.2.6 | ^17.6.0 | 17.6.0 | node >=22.22.1 | **yes (16 -> 17)** |
| prettier | ^3.6.2 | ^3.9.10 | 3.9.10 | node >=14 | no |
| use-m (scripts, runtime `use`) | unpinned | unpinned | 8.16.4 | - | n/a |

The `js/package.json` engines field already requires node >=22 (from command-stream 2.x).

### Breaking-change notes (npm)

- **ESLint 10 / @eslint/js 10**: the eslintrc format and `ESLINT_USE_FLAT_CONFIG` are removed.
  Node requirement is `^20.19 || ^22.13 || >=24`. `eslint:recommended` was updated.
  `no-shadow-restricted-names` now also reports `globalThis`. It depends on minimatch 10.
  Several deprecated formatter and context APIs were removed. `js/eslint.config.mjs` is already a
  flat config (`js.configs.recommended` + `eslint-config-prettier` + `eslint-plugin-prettier`), and
  it only *declares* `globalThis: 'readonly'` in globals (it does not shadow it), so it is compatible.
- **lint-staged 17**: Node >=22.22.1 and Git >=2.32. `yaml` is now an optional peer, so an
  extension-less `.lintstagedrc` is parsed as YAML only when `yaml` is installed. The repo
  configures lint-staged through the `package.json` key, so it is unaffected. It re-stages with
  `git update-index --again`.
- **@changesets/cli 3**: Node `^22.11 || ^24 || >=26`. The `prettier` config option was replaced
  by `format`. Yarn Classic support and the `--sinceMaster` flag were removed. Dependents bumped
  because of peer dependency changes now get a patch bump. The `$schema` in
  `js/.changeset/config.json` was updated to `@changesets/config@4.0.1` in `62a4a1a`.
- **jscpd 5**: the `format` option is now validated strictly as a language list. The old
  `"format": ["console"]` made jscpd 4 silently scan 0 files. `62a4a1a` changed it to
  `["javascript"]`, `mode: "weak"`, `threshold: 14`, so duplication checking actually runs now.
- **command-stream 2.x** (already adopted before #55): Node >=22, Execa 10, and node-pty became an
  optional dependency (2.0.1). See `command-stream-analysis.md`.

## crates.io (rust/Cargo.toml)

| Crate | Before | Branch | Latest (crates.io max_stable) | Major / breaking? |
| --- | --- | --- | --- | --- |
| command-stream | 0.13.1 | 1.9.0 | 1.9.0 (2026-10-12) | **yes (0.x -> 1.x; tui.rs edits needed, see analysis section 3)** |
| serde (derive) | 1.0 | 1.0.229 | 1.0.229 | no |
| serde_json | 1.0 | 1.0.154 | 1.0.154 | no |
| thiserror | 2.0 | 2.0.21 | 2.0.21 | no |
| tokio (full) | 1.0 | 1.54 | 1.54.0 (2026-10-19) | no (command-stream 1.9.0 itself needs tokio >=1.53) |
| tempfile (dev) | 3.0 | 3.27 | 3.27.0 | no |
| tokio-test (dev) | 0.4 | 0.4.6 | 0.4.6 | no |

Transitive crates pulled in by command-stream 1.x (nix 0.31, vt100 0.16, portable-pty 0.9,
which 8) are resolved in `rust/Cargo.lock`. Their upgrades are handled inside command-stream (1.5.2).

## GitHub Actions

| Action | Used in | Current | Latest | Breaking notes |
| --- | --- | --- | --- | --- |
| actions/checkout | js.yml, rust.yml | v6 | v7.0.1 | v7: ESM-only build; refuses to check out fork PR heads under `pull_request_target`/`workflow_run` unless explicitly allowed. No workflow here uses those triggers, so the bump is safe. |
| actions/checkout | e2e-gemini.yml:86,:278, e2e-qwen.yml:35 | **v4** | v7.0.1 | v5 moved to node24 (runner >=2.327.1). v6 persists credentials in a separate file. v7 see above. |
| actions/setup-node | js.yml, rust.yml | v6 | v7.1.0 | v6: automatic caching only for npm when `packageManager` is set. v7: ESM-only; no longer exports a dummy `NODE_AUTH_TOKEN` when `registry-url` is set. Check the npm publish step, which uses OIDC/trusted publishing or `NPM_TOKEN`. |
| actions/setup-node | e2e-gemini.yml:89, e2e-qwen.yml:38 | **v4** with `node-version: '20.x'` (e2e-gemini.yml:91, e2e-qwen.yml:40) | v7.1.0 | **Node 20 is now incompatible**: `npm install` in `js/` hits `engines` node >=22 (package, command-stream 2.x), lint-staged 17 (>=22.22.1), ESLint 10 (^22.13), and changesets 3 (^22.11). Move to `24.x` like js.yml/rust.yml. |
| actions/cache | rust.yml | v5 | v6.1.0 | v6: ESM-only. v5 already required node24 runner >=2.327.1. |
| actions/cache | e2e-gemini.yml:284 | **v4** | v6.1.0 | as above |
| dtolnay/rust-toolchain | rust.yml, e2e-gemini.yml:281 | @stable | @stable (branch ref) | none |
| oven-sh/setup-bun | js.yml | v2 | v2.2.0 | none within v2 |
| denoland/setup-deno | js.yml | v2 (`deno-version: v2.x`) | v2.0.5 | none within v2 |
| peter-evans/create-pull-request | js.yml:353, rust.yml:469 | v8 | v8.1.1 | none within v8 |
| rust-lang/crates-io-auth-action | rust.yml:264, :364 | `c6f97d42243bad5fab37ca0427f495c86d5b1a18` (v1.0.5) | v1.0.6 = `3268eb413133e2960fa4ae0e963ca76380c54cd9` | dependency-only release ("update dependencies"). Keep it SHA-pinned. |

## pre-commit (.pre-commit-config.yaml)

| Repo | Current rev | Latest | Notes |
| --- | --- | --- | --- |
| pre-commit/pre-commit-hooks | v5.0.0 | v6.0.0 | v6 removes `check-byte-order-marker` and `fix-encoding-pragma` and requires Python >=3.9. The repo uses `trailing-whitespace`, `end-of-file-fixer`, `check-yaml`, `check-added-large-files`, `check-merge-conflict`, `check-toml`, and `debug-statements`, which are all still present, so the bump is safe. |
| local hooks (cargo fmt / clippy / test) | n/a | n/a | not versioned |

## Hive Mind confirmation

- Hive Mind (`link-assistant/hive-mind`) is at **v2.39.5**, commit `5a7cb68`. It pins
  `command-stream` at **2.4.0**, which matches `^2.4.0` here.
- Hive Mind's devDependencies exactly match the branch's `js/package.json` devDependencies:
  @changesets/cli ^3.0.3, @eslint/js ^10.0.1, eslint ^10.13.0, eslint-config-prettier ^10.1.8,
  eslint-plugin-prettier ^5.5.7, husky ^9.1.7, jscpd ^5.4.2, lint-staged ^17.6.0, prettier ^3.9.10.
  Hive Mind additionally uses eslint-plugin-n ^18.5.0, eslint-plugin-promise ^7.3.0, and
  test-anywhere ^0.9.1, which agent-commander does not need.
- The bundled model catalogue sync to v2.39.5 is commit `4367abf`. The changelog and commit
  list since the baseline are in `hive-mind-changelog-2.33.15-2.39.5.md` and
  `hive-mind-commits-since-baseline.txt`.

## Remaining recommendations (not yet applied on the branch)

1. `.github/workflows/e2e-gemini.yml` and `.github/workflows/e2e-qwen.yml`: set node to `24.x` and
   bump `actions/checkout@v4` / `actions/setup-node@v4` / `actions/cache@v4` to the versions used in
   `js.yml` / `rust.yml` (v6 / v6 / v5) or to the latest (v7 / v7 / v6). This is required:
   without it, `npm install` under Node 20 fails or warns on engines.
2. Optionally bump checkout -> v7, setup-node -> v7 (verify the npm publish auth step), cache -> v6,
   crates-io-auth-action -> v1.0.6 (SHA `3268eb413133e2960fa4ae0e963ca76380c54cd9`), and
   pre-commit-hooks -> v6.0.0.
3. Optionally pin `use('command-stream@2.4.0')` in `scripts/js/*.mjs` so that release automation
   does not silently pick up future majors. Be aware of upstream #228 (login shell stdout
   pollution) when those scripts parse `$` output.
