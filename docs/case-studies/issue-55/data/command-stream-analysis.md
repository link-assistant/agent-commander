# command-stream analysis for issue #55

Research date: 2026-10-21. Upstream checkout: `link-foundation/command-stream`
(JS 2.4.0 / `js-v2.4.0`, Rust 1.9.0 / `rust-v1.9.0`, both released 2026-10-12;
these are the latest GitHub releases, npm `latest` and crates.io `max_stable_version`).
Upstream paths below are relative to the command-stream repository root.

## 1. Versions in agent-commander

| Package | Before issue #55 | Latest | Notes |
| --- | --- | --- | --- |
| npm `command-stream` (js/package.json, root package.json) | `^2.4.0` (lock 2.4.0) | 2.4.0 | Already current. `js/test/package-readme.test.mjs:37` asserts `^2.4.0`. |
| crate `command-stream` (rust/Cargo.toml) | `0.13.1` | 1.9.0 | 0.13.1 -> 1.9.0 spans 0.14-0.25 and 1.0-1.9 (one source-breaking change for us, see section 3). |
| `use('command-stream')` in scripts/js/*.mjs and `js/src/utils/loader.mjs:44` | unpinned (unpkg latest) | 2.4.0 | Resolves whatever unpkg serves at run time; `getCommandStream()` in `js/src/utils/loader.mjs:43` has no callers in `js/src`. |

## 2. How agent-commander uses command-stream today

| Location | API used |
| --- | --- |
| `js/src/tui.mjs:1`, call at ~`js/src/tui.mjs:295` | `captureTerminal({ file, args, cwd, env, cols, rows, aspectRatio, settleMilliseconds, interactions, stopMarker, stopMarkerGraceMilliseconds, timeoutMilliseconds, artifactDirectory, artifactOptions, onTrace })` |
| `rust/src/tui.rs:4`, call at `rust/src/tui.rs:376` | `command_stream::terminal::{capture_terminal, TerminalCapture, TerminalCaptureError, TerminalCaptureOptions, TerminalInteraction, TerminalKey}` |
| `rust/tests/tui_tests.rs:7` | `TerminalInteraction`, `TerminalKey`, `TerminalResize` |
| `js/test/command-stream.test.mjs:3` | `$` (apostrophe / quoted operator regression test) |
| `scripts/js/*.mjs` (5 files), `scripts/rust/*.mjs` | `$` via `use-m` for release automation |

Everything else (process spawning, process-group kill, stdin relay, quoting)
is hand-rolled:

| Hand-rolled code | What it does |
| --- | --- |
| `js/src/executor.mjs:56` `startCommand` | `spawn('bash', ['-c', command], { detached: platform !== 'win32', stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] })`, `setEncoding('utf8')`, accumulates output, mirrors when attached, `onStdout`/`onStderr` callbacks, `terminate()` = `process.kill(-pid, SIGTERM)` (no escalation), `writeStdin`/`endStdin` |
| `js/src/executor.mjs:16` `executeCommand` | dry-run + `startCommand` + `waitForExit` |
| `js/src/executor.mjs:172` `executeDetached` | `spawn(..., { detached, stdio: 'ignore' }).unref()` |
| `js/src/executor.mjs:198` `setupSignalHandler` | Node/Deno SIGINT/SIGTERM -> cleanup -> `exit(0)` |
| `rust/src/executor.rs:18` `drain`, `:43` `execute_command`, `:66` `ProcessHandle`, `:136` `start_command` | tokio `bash -c` with `process_group(0)`, `stdin(null)`, `kill_on_drop`, 8 KiB drain tasks, lossy UTF-8 |
| `rust/src/executor.rs:95` `ProcessHandle::terminate` | shells out to `bash -c "kill -TERM -- -<pid>"` (crate is `unsafe_code = "forbid"`, so no `libc::kill`), no SIGKILL escalation |
| `rust/src/executor.rs:167` `execute_detached`, `:182` `setup_signal_handler` | detached spawn, `tokio::signal::ctrl_c` |
| `js/src/tools/shell.mjs:12` `escapeArg`; `js/src/command-builder.mjs:238` `escapeQuotes`, `:250` `escapeForBashC` | quoting |
| `rust/src/tools/shell.rs:4` `escape_arg`, `:22` `escape_single_quotes`; `rust/src/command_builder.rs:62` `escape_quotes`, `:67` `escape_for_bash_c` | quoting (Rust mirror) |
| `js/src/streaming/*.mjs`, `rust/src/streaming/*.rs` | NDJSON line splitting / parsing |

## 3. Rust 0.13.1 -> 1.9.0 migration (rust/src/tui.rs)

Source-breaking changes that affect agent-commander (compare
`git show rust-v0.13.1:rust/src/terminal/types.rs` with `rust/src/terminal/types.rs` at 1.9.0):

1. `TerminalInteraction` gained `after_regex: Option<String>` (0.14.0) and
   `idle_duration: Duration` (0.14.0) - `rust/src/terminal/types.rs:47-54`.
   A full struct literal no longer compiles. Fix: `..TerminalInteraction::default()`
   (the type derives `Default`).
2. `TerminalCaptureOptions::timeout` changed from `Duration` to `Option<Duration>`
   (0.15.0, needed by `open_terminal`, which forces `None`); `Default` is `Some(30s)`.
   Fix: `timeout: Some(options.timeout)`.
3. `TerminalCaptureOptions` gained `frames_on_write: bool` (1.9.0, default false) and
   `recording: bool` (default true) - `rust/src/terminal/types.rs:57-97`. Fix:
   `..TerminalCaptureOptions::default()`.

Behaviour changes to be aware of (no code change required, but tests may notice):

- 0.18.1: an interaction with no recognised field (no `after`, `after_regex`,
  `idle_duration`, `text`, `key`, `resize`) is rejected with an error instead of
  silently waiting (upstream #202). The prompt interaction built in
  `capture_agent_tui` always has `text`, so this is safe.
- 1.9.0: PTY dimensions are validated (0 cols/rows is an error) and the child
  gets `COLUMNS`/`LINES` (`rust/src/terminal/capture.rs:356-357`).
- `TERM` is set to `options.env["TERM"]` or `xterm-256color`
  (`rust/src/terminal/capture.rs:346-352`), so the Rust side already matches the
  `TERM: 'xterm-256color'` that `js/src/tui.mjs` sets explicitly.
- 1.5.2 refreshed transitive deps (nix 0.31, vt100 0.16, which 8, portable-pty 0.9);
  1.9.0 depends on tokio 1.53+.

`rust/tests/tui_tests.rs:117-120` already uses `..TerminalInteraction::default()`
and its `timeout: Duration::from_secs(3)` is an `AgentTuiOptions` field, so tests
need no change. (Status: these three edits are already in commit `fbf2222` on this
branch.)

Optional follow-ups:

- Use `capture_terminal_async` (`rust/src/terminal/capture.rs:759`, `spawn_blocking`)
  if `capture_agent_tui` ever becomes async; today it is sync, as in 0.13.1.
- Expose `prompt_after_regex` / idle waits for the prompt interaction (JS already
  accepts a `RegExp` in `after` and `idleMilliseconds` via pass-through).
- `open_terminal` / `TerminalSession` (`capture.rs:737`, `wait_for` `:604`, `send` `:643`,
  `finish` `:677`) for long-lived interactive sessions (upstream #187); JS has
  `openTerminal` (`js/src/terminal-capture.mjs:766`).
- Agent-commander parity gaps (not upstream): Rust `AgentTuiOptions` defaults to
  80x24, but JS defaults to `cols 80, aspectRatio 4/3` -> rows `round(80 / (2 * 4/3)) = 30`
  (`js/src/terminal-capture.mjs:454`). Rust also has no `artifacts` selection and no
  `on_trace`, because upstream Rust lacks `aspect_ratio` and an `on_trace` hook (see section 5).

## 4. Adoption candidates

Verdict key: **Adopt** = safe and beneficial now; **Adopt with care** = beneficial,
but behaviour changes need explicit handling or tests; **Keep** = no fit upstream.

### 4.1 Rust: replace `start_command` / `ProcessHandle::terminate` with `StreamingRunner::from_argv` - Adopt with care

- Upstream API: `StreamingRunner::from_argv<P, I, S>(program: P, args: I) -> Self`
  (`rust/src/stream.rs:123`), `.kill_signal(..)` (`:191`), `.kill_grace_ms(u64)` (`:202`),
  `.exit_pump_grace_ms(u64)` (`:210`), `.stream() -> OutputStream` (`:277`);
  `OutputStream::next()` (`:341`), `pid()` (`:359`), `wait_for_pid()` (`:368`),
  `kill()` (`:383`), `kill_with(&str)` (`:390`), `exit_signal()` (`:347`).
  The spawn path (`rust/src/stream.rs:495-525`) does exactly what agent-commander does:
  `kill_on_drop(true)`, `stdin(null)` when no content, piped stdout/stderr, and `process_group(0)`.
- Replaces `rust/src/executor.rs:66-165` (`ProcessHandle`, `drain`, `start_command`) and,
  most valuably, the `bash -c "kill -TERM -- -<pid>"` shell-out in `rust/src/executor.rs:95-123`.
  Upstream does group signalling plus SIGKILL escalation after `kill_grace_ms` without
  agent-commander needing `unsafe`.
- Use `from_argv("bash", ["-c", command])` rather than `ProcessRunner::new(command, ..)`.
  `ProcessRunner` (`rust/src/lib.rs:303`) runs through `/bin/sh -c` (`rust/src/utils.rs:84-89`),
  intercepts built-in "virtual" commands by first word (`lib.rs:356-372`), and prepends
  `export PWD=..; OLDPWD=..;` when env carries them (`utils.rs:32-54`). All three are
  behaviour changes the current executor does not have.
- Care points:
  - Exit code after cancel becomes 143 (128+SIGTERM) instead of `status.code().unwrap_or(1)` = 1.
    The `rust/tests/hive_mind_parity_tests.rs` / `js/test/hive-mind-parity.test.mjs:146-157`
    cancel test only asserts `!= 0`, so it still passes.
  - The default `kill_grace_ms` is 100 ms (`rust/src/signal.rs:46`), after which SIGKILL
    follows. Agent CLIs (claude/codex) may need longer to flush session files. Set an
    explicit grace such as 2000-5000 ms.
  - Mirroring when `attached` must be done by the consumer loop (write `OutputChunk::Stdout`
    bytes to stdout). Decode once at the end with `String::from_utf8_lossy` to keep the
    current exact-bytes semantics.
  - No live stdin pipe on `StreamingRunner` (only `.stdin(content)` / `.stdin_bytes`).
    That is fine for today's Rust executor (stdin null), but it blocks a Rust
    permission-relay parity with JS `pipeStdin`; see 5.3.
  - `exit_pump_grace_ms` (default 100 ms) stops waiting for pipes held open by grandchildren
    after the main child exits. This improves on the current `wait()` + join of the drain
    tasks, which can hang if an agent leaves a background MCP server holding stdout.

### 4.2 Rust alternative: `ProcessRunner` + `write_stdin` / `close_stdin` / `kill_with` - Keep for now

- `ProcessRunner::write_stdin(&mut self, data) -> Result<()>` (`rust/src/lib.rs:492`),
  `close_stdin` (`:510`), `kill()` (`:703`), `kill_with(&str)` (`:730`), `pid()` (`:837`),
  `child() -> Option<ProcessChild>` (`:483`), `RunOptions { mirror, capture, stdin:
  StdinOption::{Inherit, Pipe, Content, Null}, cwd, env, kill_signal, kill_grace_ms, .. }`
  (`rust/src/run_options.rs:72-103`, `:125`).
- This is the only Rust runner with a live stdin pipe. It is shell-string only
  (`/bin/sh`), with no argv constructor, and `run(&mut self)` borrows mutably, so it cannot
  be killed from another task while awaiting. agent-commander's `cancel` is sequential
  (`terminate` then `stop`, `rust/src/lib.rs:578-586`), so that works. But the
  `/bin/sh` + virtual-command + `export PWD` differences make 4.1 the better fit.
  Revisit once upstream adds argv + stdin pipe (5.3).

### 4.3 JS: replace `startCommand` with `ProcessRunner` exec mode - Adopt with care

- Upstream API: `import { ProcessRunner } from 'command-stream/process-runner'`
  (lightweight entry, `js/src/process-runner.mjs`, package export `./process-runner`,
  no PTY/resvg/gifenc loading - upstream #192);
  `new ProcessRunner({ mode: 'exec', file: 'bash', args: ['-c', command] }, { mirror: attached, capture: true, stdin: pipeStdin ? 'pipe' : 'ignore', killSignal: 'SIGTERM', killGrace, exitPumpGrace })`;
  `runner.pid` (`js/src/$.process-runner-base.mjs:394`), `runner.child` (`:412`),
  `runner.stdin` (`:455`, writable stream wrapper), `runner.kill(signal)`
  (`js/src/$.process-runner-stream-kill.mjs:491`, group signal + `killGrace` escalation),
  events `stdout`/`stderr`/`data` (Buffers, `$.process-runner-base.mjs:634-645`), `exit(code, signal)`,
  and `await runner` -> `{ code, stdout, stderr }`.
  The Node spawn already uses `detached: platform !== 'win32'` with piped stdio
  (`js/src/$.process-runner-execution.mjs:150-170`). `stdin: 'pipe'` leaves stdin open
  for manual writes (`:415`).
- Replaces `js/src/executor.mjs:56-165` (`startCommand`: spawn, accumulate, mirror,
  `terminate`, `writeStdin`, `endStdin`). Callers stay the same if the handle shape
  (`waitForExit`, `getOutput`, `terminate`, `writeStdin`, `endStdin`, `process`) is kept:
  `js/src/index.mjs:381-385` (signal cleanup), `:420` (start), `:428-439` (PermissionRelay
  NDJSON writes), `:623` (`cancel`).
- Benefits: SIGKILL escalation after `killGrace` (today a child ignoring SIGTERM keeps
  running), `exitPumpGrace` for grandchild-held pipes, Windows descendant kill (1.5.1 / #205),
  and exit codes that report signals (143) instead of `code ?? 1`. It also gives
  one implementation shared with the Rust side.
- Use `mode: 'exec'` with `file: 'bash'`. Shell mode goes through the login-shell path
  (`sh -l -c`, upstream #228) and virtual-command interception, which would change
  behaviour.
- Care points:
  - Chunks are `Buffer`s, so `onStdout`/`onStderr` need a streaming
    `new StringDecoder('utf8')` (or `TextDecoder` with `{ stream: true }`) per stream to keep
    the current `setEncoding('utf8')` semantics. Otherwise a multi-byte character split
    across chunks corrupts NDJSON lines in `JsonOutputStream`. Mirroring is done by the
    runner with raw bytes (`mirror: true`), which is better than today's decoded re-write.
    ANSI is preserved by default (`globalAnsiConfig` `preserveAnsi: true`, `js/src/$.ansi.mjs:65-68`).
  - `stdin: 'ignore'` spawns a pipe and ends it immediately (`$.process-runner-execution.mjs:407`)
    rather than `/dev/null`. Both give EOF and neither is a TTY, so the effect is equivalent for
    the agent CLIs, but it is a difference.
  - Global SIGINT handler (`js/src/$.state.mjs:160-225`): while a runner is active,
    command-stream forwards SIGINT to the runner's process group and calls `process.exit(130)` **only**
    if no other SIGINT listener exists. In isolation `none`, agent-commander installs its own
    handler (`js/src/index.mjs:379`), so upstream only forwards and agent-commander's
    cleanup still runs. With screen/docker attached runs (no agent-commander handler),
    Ctrl+C would now be forwarded to the child group and then exit 130. That is reasonable,
    but document it and test it.
  - The default `killGrace` is 100 ms. Pass a larger value, like the Rust side.
  - The CI matrix runs Bun and Deno (`.github/workflows/js.yml:172-190`). ProcessRunner has a
    Bun spawn path (`$.process-runner-execution.mjs:118-130`), so the executor tests must stay
    green on all three runtimes before switching.
- Keep `executeDetached` (`js/src/executor.mjs:172`): upstream has no fire-and-forget
  `unref` API.

### 4.4 Quoting helpers - Adopt the exact-equivalent ones, keep `escapeArg`

- `js/src/command-builder.mjs:250` `escapeForBashC` is byte-for-byte equal to upstream
  `escapeForDoubleQuotes` (`js/src/$.quote.mjs:223`, not exported from the package entry,
  but reachable as `quoteForContext(value, 'double')`: `$.quote.mjs:241`, exported from `$.mjs:20`,
  typed in `types/api.d.cts:539-546`). Rust `escape_for_bash_c` (`rust/src/command_builder.rs:67`) is
  equal to `command_stream::quote::escape_for_double_quotes` (`rust/src/quote.rs:207`) /
  `quote_for_context(v, QuoteContext::Double)` (`:229`).
- `js/src/command-builder.mjs:238` `escapeQuotes`, `rust/src/command_builder.rs:62` `escape_quotes`, and
  `rust/src/tools/shell.rs:22` `escape_single_quotes` equal `escapeForSingleQuotes` / `escape_for_single_quotes`
  (`rust/src/quote.rs:189`).
  - Note: the JS helper returns `''` for falsy input; upstream returns `''` for `''` but throws on
    `undefined`. Keep the guard.
- Swapping these is safe (identical output) and modestly beneficial: one audited implementation,
  covered by upstream's injection tests (0.18.0).
- `escapeArg` / `escape_arg` (`js/src/tools/shell.mjs:12`, `rust/src/tools/shell.rs:4`) emit
  **double-quoted** strings for unsafe input. Upstream `quote()` / `quote::quote()` emit
  **single-quoted** strings and a slightly different safe set (`[a-zA-Z0-9_\-./=,+@:]`,
  without `%`). Replacing them changes every generated command string and breaks the
  exact-string assertions in `js/test/*` / `rust/tests/*`. **Keep.**
- **Parity bug to fix in agent-commander (not upstream):** `rust/src/command_builder.rs:75-87`
  `build_tool_command` (generic or unknown tool path, used at `:288` and `:296`) emits
  `--prompt "{escape_quotes(p)}"`, which is a single-quote escape inside double quotes. `$`,
  backticks, `"` and `\` in a prompt are therefore interpreted by bash, and an apostrophe
  turns into a literal `'\''`. JS `buildToolCommand` (`js/src/command-builder.mjs:144-158`)
  uses `escapeArg`. Fix by using `escape_arg(p)` in Rust (same for `--system-prompt`).

### 4.5 Terminal capture (JS already on 2.4.0) - optional enhancements

- `frameMode: 'writes'` / Rust `frames_on_write` (2.4.0 / 1.9.0) give a frame per PTY write. This
  is useful for e2e debugging but increases `frames.json` size. Expose it as an opt-in pass-through.
- `recording: false` skips asciicast/recording work when only `transcript`/`snapshot` are wanted.
  Map it from `artifacts` once upstream supports artifact selection (5.1).
- `openTerminal` / `open_terminal` support long-lived interactive sessions (upstream #187).
- Live subscriptions / `TerminalBuffer` deltas (2.4.0 / 1.9.0): not needed by agent-commander today.

### 4.6 Keep

- `setupSignalHandler` (JS `js/src/executor.mjs:198`, Rust `rust/src/executor.rs:182`): upstream's
  handler is global and only forwards SIGINT. It has no cleanup-callback API.
- NDJSON parsing (`js/src/streaming/*`, `rust/src/streaming/*`): upstream offers
  `stream(source).lines()` (`js/src/stream-processing.mjs:172`, StringDecoder based) and Rust
  `DataStream` (1.6/1.8), but no NDJSON parser with agent-commander's split-line buffering
  semantics. The gain does not justify the churn.
- `executeDetached` / `execute_detached`: no upstream equivalent.

## 5. Upstream bugs and missing features (not filed; existing matches noted)

Existing open issues (checked 2026-10-21 with `gh issue list --repo link-foundation/command-stream --state all`, 97 issues):

| # | State | Relevance to agent-commander |
| --- | --- | --- |
| #228 | OPEN | `$` runs `sh -l -c`; profiles reorder PATH and can print to stdout (`js/src/$.shell.mjs:238-246`; pipeline drops `-l` at `$.process-runner-pipeline.mjs:277`). This affects `scripts/js/version-and-commit.mjs:129` (`git show origin/main:js/package.json` parsed as JSON), `:169/:172` (`git rev-parse`), and `scripts/js/publish-to-npm.mjs:78` (`npm view ... version`). It is also why 4.3 must use `mode: 'exec'`. |
| #227 | OPEN | `$({ timeout })` is silently ignored. Only `signal` bounds a command. agent-commander does not pass `timeout` to `$` today. Avoid relying on it (use `AbortSignal.timeout(ms)`). |
| #226 | OPEN | crates.io trusted publishing. Release-infra only, no impact. |
| #187, #192, #202, #205, #207, #208, #218, #219, #221 | CLOSED | Fixed in the versions we target: openTerminal, lightweight ProcessRunner entry, empty-interaction rejection, Windows descendant kill, aborted-signal stream hang, signal exit codes, node-pty optional (2.0.1), Deno esm.sh, braces audit (2.0.2). |

New findings with no matching issue (candidates for upstream reports):

1. **No artifact selection in terminal capture (JS + Rust).** JS `writeTerminalArtifacts`
   (`js/src/terminal-artifacts.mjs:493-530`) always renders and writes all six files,
   including `recording.gif` via resvg + gifenc (`:424-469`, the most expensive step). Rust
   `write_terminal_artifacts` (`rust/src/terminal/artifacts.rs:174`) always writes five. Neither has
   an `artifacts`/`formats` option. agent-commander works around it by deleting unrequested files
   after capture (`selectArtifacts`, `js/src/tui.mjs:~145-160`), which wastes the GIF render time.
   No existing issue matches.
2. **Rust/JS terminal parity gaps.** The Rust `TerminalCaptureOptions` (`rust/src/terminal/types.rs:57-76`) has
   no `aspect_ratio` (JS `aspectRatio`, `js/src/terminal-capture.mjs:454`), no `on_trace` callback
   (JS `onTrace`, `createCaptureRecorder` `:247`), no `label`, and no GIF artifact (JS writes `recording.gif`).
   No existing issue matches. (#175/#174 introduced the feature; the parity gaps are not tracked.)
3. **Rust has no argv runner with a live stdin pipe.** `ProcessRunner` has `write_stdin`/`close_stdin`
   (`rust/src/lib.rs:492-516`) but only accepts a shell string run by `/bin/sh -c` with
   virtual-command interception. `StreamingRunner::from_argv` (`rust/src/stream.rs:123`) has exact
   argv but only one-shot `stdin(content)` / `stdin_bytes` (`:168-176`), so there is no way to
   write NDJSON frames while streaming. JS supports this (`{mode:'exec'}` + `stdin:'pipe'`). #190
   (argv for streaming on Windows) is closed but did not cover live stdin. This is a new request:
   `OutputStream::write_stdin` / `close_stdin`, or `ProcessRunner::from_argv`.
4. **Minor TERM semantics difference between JS and Rust.** JS `startTerminal` uses
   `env.TERM ?? 'xterm-256color'` over the caller-provided env (`js/src/terminal-capture.mjs:400`).
   Callers usually spread `process.env`, so an inherited `TERM=dumb` (CI) survives unless
   overridden. agent-commander forces `TERM` in `js/src/tui.mjs` for this reason. Rust looks only at the
   explicit `options.env` map and defaults to `xterm-256color` (`rust/src/terminal/capture.rs:346-352`).
   This is low severity and arguably consistent. Report it as a documentation clarification
   rather than a bug.
5. **JS escape helpers not exported.** `escapeForSingleQuotes` / `escapeForDoubleQuotes`
   (`js/src/$.quote.mjs:209,223`) are not exported from `command-stream` (only `quoteForContext`
   with string contexts), while Rust exports `escape_for_single_quotes` / `escape_for_double_quotes` publicly.
   This is a small JS/Rust API parity gap.
6. **No fire-and-forget detached spawn.** There is no `unref`'d detached spawn returning a pid in
   either language, so agent-commander keeps `executeDetached` / `execute_detached`. Low priority.

## 6. Upstream release timeline (for the case study)

Rust (crate): 0.14.0 regex markers + idle waits; 0.15.0 `open_terminal`/`TerminalSession`, optional
timeout (breaking); 0.16.0 `StreamingRunner::from_argv`; 0.17.0 `QuoteContext`, `quote_for_context`,
`escape_for_*`; 0.18.0 quoting/injection fixes; 0.18.1 empty interactions rejected; 0.18.5
`Error::code`/`error_for_status`; 0.21 `kill_with`, kill grace + SIGKILL escalation, process group for
`ProcessRunner`; 0.23 `pid()`; 0.24 `write_stdin`/`close_stdin`; 0.25 `child()`/`ProcessChild`;
1.0.0 stdout/stderr snapshots and stdin record on results; 1.1 `collect_blocking`; 1.2 `bun_shell`;
1.3 `zx`, `prefer_local`; 1.4 `execa`, full-duplex stdin deadlock fix, native signal metadata;
1.5.1 Windows descendant kill, POSIX escalation; 1.5.2 nix 0.31.3 / vt100 0.16.2 / which 8.0.6,
cancelled output no longer waits on inherited pipes; 1.6 `CommandBuilder`, `fy`, `DataStream`,
`TerminalBuffer`; 1.7 repl/dev; 1.8 stream batching, `sliding_window`; 1.9 ANSI buffer deltas,
live subscriptions, `frames_on_write`, validated dimensions, `COLUMNS`/`LINES`.

JS (npm): 2.0.0 (2026-10-07) Node >= 22, Execa 10, node-pty 1.1.0; 2.0.1 node-pty optional, Deno
esm.sh fix; 2.0.2 ShellJS removed from consumer deps (braces audit); 2.1.0 literal command builders,
`fy`, bounded stream processing, `TerminalBuffer`, TypeScript declarations; 2.2.0 REPL API; 2.3.0
size-or-deadline batching, `slidingWindow`; 2.4.0 compact terminal changes, live PTY subscriptions,
per-write frames, validated PTY dimensions.
