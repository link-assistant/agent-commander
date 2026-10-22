# @link-assistant/hive-mind

## 2.39.5

### Patch Changes

- 766e2ea: Formal AI sidecar: check on every start that `box` can write the `hive-mind-formal-ai-memory` volume and `chown -R` it (as root) only when it cannot, logging `[formal-ai] memory volume was owned by <uid:gid>; fixed`; turn a `logging_failure` in the sidecar's first stdout lines into a warning in the bot log and the solve log; and save `docker logs --timestamps` to a rotated `formal-ai-sidecar-<start>.log` in the bot log directory before every `docker rm` of the sidecar (`HIVE_MIND_FORMAL_AI_SIDECAR_LOG_KEEP`, default 50) (#3583).

## 2.39.4

### Patch Changes

- a552987: A Claude, Codex or OpenCode run that stops on a usage limit is now reported as a usage limit, with its reset time, even when the tool does not say so in its last output line (#3570). Before, such a run failed with "Claude command failed with exit code 1" and was never resumed.

  - **Claude:** on a failed exit, solve checks five sources, and any one of them is enough:
    - the `result` event or the last line;
    - the synthetic assistant `is_api_error_message`;
    - the session transcript tail (`isApiErrorMessage`);
    - the last `rate_limit_event` (`rejected` with `resetsAt`);
    - the `ANTHROPIC_LOG=debug` 429 headers (`anthropic-ratelimit-unified-status: rejected` with `anthropic-ratelimit-unified-reset`).

    An epoch reset gives the full date, for example `Oct 20, 2026, 11:00 AM` (UTC). A `rejected` event without `resetsAt` stays the #1924 throttle.

  - **Codex:** on a non-zero exit that a signal did not cause, solve reads the last turn of the thread's rollout. A `token_count.rate_limits` window at 100% with `resets_at`, or an `error` event with `usage_limit_exceeded`, counts as a usage limit. A limit from an earlier turn does not. The Codex runner now also returns `limitTimezone`.
  - **OpenCode:** a usage limit inside any `{"type":"error"}` record is found, not only one in the last stdout chunk.
  - `ANTHROPIC_LOG=debug` dumps and base64 body lines are no longer used as the failure reason.
  - In verbose mode, every source is logged with its verdict (`🔍 Usage-limit cross-check (issue #3570):`). solve warns `⚠️ Usage limit found only in: …` when the tool's own output missed the limit.

  Also brings the pins that the CI dependency-freshness gate reported as stale up to date: `jscpd` 5.4.2 (devDependency and its platform packages) and the `@opentelemetry/api` 1.10.0 lockfile entry.

## 2.39.3

### Patch Changes

- 4d5658e: A push answered by GitHub with `remote: fatal error in commit_refs` / `[remote rejected] … (failure)` is now treated as a transient GitHub server error, not a branch divergence (#3552):

  - `git push`/`fetch`/`pull` retry it with the usual backoff instead of giving up after one attempt (`transient=no`).
  - If every retry fails, the solver reports `GitHub server error while pushing …` and tells the user to check githubstatus.com and rerun. It no longer says "Local and remote branch histories differ" or asks the user to merge a branch that does not exist on the remote.
  - Push explanations no longer claim "the remote branch changed" when the remote branch does not exist.
  - The release version push retries such errors without rebasing, and the Helm `gh-pages` pushes retry them too.
  - In verbose mode, the push-rejection classification and the remote branch state are logged.

  Every GitHub operation now goes through one shared retry loop, and lint enforces it (#3552 review):

  - command-stream's `$` resolves a failed `gh` call instead of rejecting, so `gh` commands sent through `wrapDollarWithGhRetry` ran only once, rate limits and 5xx included. `retryGitHubOperation` (`src/github-operation-retry.lib.mjs`) retries both shapes. `ghWithRateLimitRetry`, `ghRetry`, `ghCmdRetry`, `gitCmdRetry`, the runner and sync adapters, and the release scripts all use it in place of their own loops.
  - `wrapDollarWithGitRetry` (codex, agent, gemini, opencode, qwen) now retries `gh` too, and wrapping an executor twice no longer nests two loops.
  - Previously unretried call sites in `src/` and `scripts/` are routed through the shared loop. A retried `gh issue create` checks for the created issue first, so it is never filed twice.
  - The `gh-rate-limit` ESLint rules decide per call site, not per file. They cover the `spawn`/`execFile` argv style and, for git, `scripts/`.
  - Shell scripts and workflow steps run GitHub operations through `node scripts/github-retry.mjs …`. `scripts/check-github-retry-shell.mjs`, which is part of `npm run lint`, rejects any that do not. A deliberate single shot is marked `github-retry-ok: <reason>`.

  Also brings the pins that the CI dependency-freshness gate reported as stale up to date: `start-command` 0.38.0 (all Dockerfiles), `links-notation` 0.27.1 (use-m pins), the `ignore` lockfile entry 7.0.13, `formal-ai` 0.355.0 (all Dockerfiles; its new GPU stack is behind a non-default feature), `@dotenvx/dotenvx` 2.38.1 (use-m pin), and the `@formatjs/icu-messageformat-parser` 3.5.22, `fast-uri` 3.1.9 and `intl-messageformat` 12.1.4 lockfile entries.

## 2.39.2

### Patch Changes

- acc3d47: `/fix` replies in Telegram now go Starting → Waiting for CI/CD → Executing, and dynamic values are escaped in every legacy-Markdown message (#3505):

  - The CI wait is one simple `⏳ Waiting for CI/CD on <branch> to finish...` line. It no longer lists pending runs, whose raw `in_progress` status broke Telegram Markdown and made the reply fall back to plain text.
  - No `✅ CI/CD on main finished` line stays in the reply, and `Executing...` is shown only once the task runs.
  - The `Issue:` line is placed in the info block under `Repository:` with the first progress marker and never moves.
  - A new ESLint rule `telegram-safety/no-unescaped-telegram-markdown` reports unescaped dynamic values in legacy-Markdown Telegram messages. All its hits were fixed: recovery lifecycle, `/tokens`, `/organize`, `/stop` and `/start` reasons, queue warnings and errors, and the leak notifier.
  - A "Did you mean" suggestion containing a backtick no longer breaks its code span.
  - "❌ Invalid options" replies keep their "Did you mean `--model` option?" code spans while the rest of the error is escaped.
  - The "stopped by user" completion reads `Work session stopped by user (@name)` instead of `stopped by user by @name`.
  - `eslint-plugin-n` 18.5.0 (the dependency-freshness gate required it).

## 2.39.1

### Patch Changes

- dbb8292: GitHub release notes keep the Markdown structure of the changeset (issue #3445). The formatter no longer trims every line, so later paragraphs and nested lists of a changeset stay inside its list item, as in `CHANGELOG.md`. It also keeps every `### Major/Minor/Patch Changes` section, the first `- <hash>:` marker, text after `---`, a literal `\n` and trailing quotes. Major and Minor releases are now formatted too, and `--verbose` logs what was found. The release section is taken from the whole `## <version>` heading line, so `2.3.1` no longer matches `2.3.10`, and a multi-line manual release description is indented in `CHANGELOG.md` like a changeset.

  The publication sanitizer no longer masks code and option names in release notes: `false`, `…` and `<placeholder>` values, identifiers such as `KNOWN_LOCAL_TOKEN_ENV_VARS`, and options such as `--tokens-budget-stats` or `--max-tokens`. Real credentials next to them are still masked.

  `scripts/repair-release-notes.mjs` rebuilds published releases from `CHANGELOG.md`. It is a dry run by default; `--apply` updates the releases and `--backup-dir` saves the old bodies. It was used to repair the 368 damaged releases.

## 2.39.0

### Minor Changes

- 8ffc571: The requirements report is now experimental and off by default, Telegram status messages show the pull request as soon as it exists, and auto-restart no longer stops on a stale "no progress" verdict (#3469):

  - `--requirements-report` (or `HIVE_MIND_REQUIREMENTS_REPORT=true`) turns the #2406 report back on. Without it no prompt tokens are spent on the report, the merge guard does not check it, and no completion restart waits for it.
  - A running session's reply gets its `Pull request:` line once solve prints its PR URL, and `/fix` replies also show the PR of the issue that `/fix` created.
  - `--auto-restart-until-mergeable` restarts when HEAD moved after a repeated session, and a completion restart no longer counts as a repeated session.
  - Node 26 (V8 14.6) resolves a top-level `await import()` of a module that is still evaluating too early (nodejs/node#66806). Every such import in `src/` is now static, so the merge guards no longer throw `Cannot access '…' before initialization`.
  - The agentic CLI updater reads a CLI's version from the package that owns its binary, so gh-setup-git-identity and claude-profiles no longer report a false "Could not update".
  - Quiet probes pass `mirror: false` (`$` has no `silent` option), so the 403 of `gh api user` under an installation token no longer appears in the log.
  - Clearer warnings when Docker disk space cannot be read and when a directly started session matches no queue item, and a mid-sentence `fix: <foreign issue URL>` is no longer treated as an intended close.
  - With `--requirements-report`, the merge guard and the report template now compute the same digest of the issue feedback. Before, the guard left out the session-start comment its own solve had posted, so every fresh report was rejected as "changed after verification". Interactive-mode tool comments now start with a hidden `<!-- hive-mind:interactive-mode -->` line for the same reason.

## 2.38.0

### Minor Changes

- 03d1372: `/fix --update-all-dependencies` and `/task --update-all-dependencies` now merge every open Dependabot pull request before creating the maintenance issue, without waiting for CI/CD (issue #3413). Pull requests are merged oldest first with the repository's preferred merge method, pinned to the reviewed head commit, and retried once with `--admin` when only branch rules block them. The generated issue starts with a section that lists each merged pull request and the checks that were not passing at merge time, and asks the solver to fix every error those merges introduced. It also lists the pull requests that could not be merged, so their updates are applied by hand. `--dry-run` only lists the pull requests, and `--no-merge-dependabot-prs` turns the step off.

  Also refreshes the `@dotenvx/dotenvx` (2.38.0) and `links-notation` (0.27.0) runtime pins flagged by the dependency freshness gate.

## 2.37.1

### Patch Changes

- 68f606a: Auto-continue and auto-restart no longer report a pull request or issue description edit that never happened (issue #2293). Feedback detection used to treat a REST `updated_at` later than the last commit as "description was edited", but GitHub bumps `updated_at` for comments, labels, cross-references and pull request creation, and real edits after the last commit were usually made by the previous solver session under the same account. The check now reads the GraphQL edit history (`userContentEdits` for descriptions, `RenamedTitleEvent` for titles), ignores bot edits and edits by the solver's own account inside a solver session window (derived from the session marker comments and the pull request creation time), and reports each remaining edit with its evidence: time, editor and a diff excerpt. When there is no separate linked issue (the issue number falls back to the pull request number), the pull request is no longer checked a second time as its own issue, and the auto-restart loop no longer watches the pull request's own title and description as issue feedback. Every auto-restart reason now comes with evidence. The "Auto-restart N/M" comment used to say only "CI failures detected" or "Issue title and description edited", so nobody could check from the pull request whether a restart was justified. It now lists each failing check with the URL of its run, each triggering comment with its author, time and link, and each issue title or description edit with what changed. The same lines are written to the log. When the same checks fail on consecutive restarts, both the comment and the next session's prompt say so, and the session is told to re-read the failing job logs and change approach. When the same checks fail with the same output on 3 restarts in a row (URLs, timestamps, commit ids and durations are ignored), the run stops as a failure instead of restarting again: the pull request goes back to draft, uncommitted work is committed, and a stop comment quotes the repeated output. A check whose output changes still counts as progress, and a check without output is never treated as repeated. `HIVE_MIND_CI_FAILURE_REPEAT_STOP` sets the count, and `0` turns the stop off. Under `--verbose`, Codex's `RUST_LOG=debug` tracing no longer fills a third of the solve log: TRACE/DEBUG/INFO lines go to a `<log>.codex-trace.log` file next to it, each distinct WARN or ERROR line is logged once with its repeat count at the end, and Codex's compaction diagnostics still read every line. The watch loop's probes (the pull request's comment threads, the account login, `.merged`, `.state` and `mergeStateStatus`) are read without being mirrored, so the raw comments JSON (180 KB on link-foundation/meta-language#196) no longer lands in the log on every check. A task container that is kept after the task (`HIVE_MIND_KEEP_TASK_CONTAINER`) no longer holds gigabytes of regenerable build output: once the workspace has no uncommitted changes and nothing unpushed, its `CACHEDIR.TAG` directories (Cargo `target/`) and `node_modules/.cache` are deleted, and the log says what was freed or why the caches stayed. The configuration docs now explain that `keepContainer false` / `keepContainerOnFail false` in `$ --status` is start-command's default, which keeps a container whose command exited non-zero. `$ --status` showing the `containerId` of a removed container, and options printed as `[object Object]`, are reported upstream as link-foundation/start#225 and link-foundation/start#226.

  A failed `$ --status` query no longer ends the tracking of a work session (issue #2303). Every failure of start-command used to look like a missing record, so a single transient failure, or a `$` that could not write its own store on a full disk, posted "Work session ended, but its exit status is unknown" with no kill diagnosis and no automatic resume. A failed query is now told apart from a missing record. The session stays tracked for five consecutive failures (the streak is persisted and cleared by the next answer), and a written log footer still settles the outcome at once. After that, a docker session is judged by `docker inspect`: a running container stays tracked, an exited one uses docker's own exit code (`OOMKilled` counts as a kill), and a container that is gone without an exit footer is reported as killed. That kill gets the kill diagnosis and the default `--on-session-kill=resume` recovery. Other backends use the existing liveness probe. A docker work session whose exit docker never observed is now reported as a kill instead of a success. When start-command's watcher lost a still-running container (for example `docker logs -f` failing on a full disk), the record said `executed` with exit 0 (or `-1` with `exitReason: watcher-lost-container` on newer start-command), and Hive Mind announced "Work session finished successfully". Such an exit (`endTimeSource: observed-at` or `watcher-lost-container`) is now reclassified as killed, so the kill diagnosis, the pull request notice and the default `--on-session-kill=resume` recovery run. A `-1` log footer no longer skips the container liveness check. The monitor also samples the host disk while a session runs, and an `ENOSPC` line in the log counts as evidence, so the diagnosis and the Telegram headline can name the real cause ("killed (disk full)"). A container that start-command already removed is no longer reported as "Docker container kept".

  Require complete issue delivery before automated merges (#2406): every tool's system, initial and continuation prompts (including the minimal claude resume prompt) now state the complete-delivery goal and ask for a requirements report; Codex keeps `features.goals=true` in both the direct and agent-commander paths regardless of `--auxiliary-model-calls-disabled`; the shared merge path fails closed unless the pull request description holds a requirements report tied to the current head SHA and to a digest of the issue, its comments and all pull request feedback, with `done` status and evidence for every criterion, and it merges with `--match-head-commit`; after a solve, bounded completion restarts run without any optional flag until the report passes.

  Install jq in every hive-mind Docker image built from a Box base (Dockerfile, Dockerfile.dind and coolify/Dockerfile; Dockerfile.formal-ai and Dockerfile.e2e inherit it) when the base lacks it, and check it in scripts/verify-docker-image.sh so an image without jq fails verification. AI tools' `… | jq …` commands and the solver's printed "Raw command" (`… | jq -c .`) no longer exit 127 with `jq: command not found` (issue #2846).

  Kill recovery of a task started with a Telegram alias such as `/codex` runs `solve`, never the alias (issue #2887). A regression test replays the router#728 incident and checks both the in-place `$ --resume` command and the fresh-launch fallback. If an in-place recovery session still exits with 126 or 127 and that exit is only noticed when the session completes, the session is no longer dropped. Recovery starts again as a fresh isolated session under the same attempt number. A fresh session that fails this way is not retried again. The completion message for an exit of 127 or 126 now says "command not found" or "command not executable" in every locale. A recovery container's own exit 127 is still reported as a failure, not as its predecessor's `oom-killed`.

  Kill recovery in a new Docker container can now resume Codex threads (issue #2888). solve writes Codex rollouts from its repository-scoped `CODEX_HOME` to the mounted `~/.codex/sessions` directory, so a recovery container can find them. For runs started before this change, recovery copies the thread's rollout out of the killed container. If the thread still cannot be found, recovery starts a new Codex session on the same branch and says so in the recovery notice, instead of launching `codex exec resume` that would fail at once with "no rollout found". solve also starts a new session, with a warning, when it is asked to resume a thread whose rollout is not in its scoped `CODEX_HOME`. A recovery session that solve refuses to start for lack of disk space (exit 75) no longer uses up a recovery attempt. Once enough space is free, it is relaunched under the same attempt number, at most 6 times per recovery chain. agent, gemini, qwen and opencode keep their sessions inside the container, where no new container can read them, so a fresh recovery drops their `--resume` and the notice says so. claude keeps its `--resume`, because its transcripts are in a mounted folder, except under `--use-router`. Two solves of the same repository that share the Codex sessions folder at the same moment no longer fail with EEXIST: the second one uses the link the first one made.

  In-place kill recovery now copies less and cleans up after itself. Containers started by start-command 0.37.0 or later resume with `docker start` and skip the snapshot queue and disk wait entirely, and the notice says "no snapshot needed". Older containers that Hive Mind started behind its fail-closed start gate are briefly started while the gate still holds them idle, so their regenerable build caches (directories tagged with `CACHEDIR.TAG`, such as Cargo `target/`, and `node_modules/.cache`) can be deleted before the commit. Source trees are never touched. The notice then reports "Removed X GiB of regenerable build caches" and "Snapshotting X GiB (Y free, Z needed)". Once the snapshot-derived container has started, the stopped original is removed. When the task's last container is removed, its `start-command-resume/*` snapshot images are removed too. A killed session's completion no longer removes the container that a `docker start` recovery is now running in. The snapshot images of a container that start-command already removed are removed too. In-place kill recovery no longer fills the disk when several task containers are killed at once. Container snapshots (`docker commit` of the stopped container's writable layer) now run one at a time, and each starts only when the Docker data root has twice the writable layer plus 10 GiB free. While a recovery waits, its notice says so ("Waiting for N other container snapshots to finish first" or "Waiting for disk: X free, Y needed"); if the space does not appear within ten minutes, the recovery starts a fresh isolated session instead of snapshotting. A layer whose size cannot be measured still has to leave the 10 GiB reserve free (issue #2889).

  Kill-recovery notices, completion links and log attachments now use the session's own pull request. When an issue is linked to several pull requests (for example a parent plan pull request that lists its sub-issues), the bot picks the one on the `issue-<n>-*` branch of the session's issue and never one whose branch belongs to another issue; the session-log fallback prefers the `PR URL:` line printed by solve over the first pull request mentioned in the log. Without an own pull request, a failed recovery is reported on the session's issue. `/merge` uses the same choice, so a ready sub-issue is merged through its own pull request, never through an older parent plan pull request that also closes it (issue #2891).

  The issue-link repair now respects the agent's decisions (issue #3174). Wording such as "#236 to #246 stay open", "#2 and #3 stay open" or "#2, #3 remain open" keeps every listed issue open, not only the first one. The repair checks the pull request's description history and no longer re-adds a sub-issue closing line that the session removed after an earlier repair added it. It reports the conflict once in a pull request comment instead, and the merge guard keeps the merge blocked until someone decides. A negated keyword such as "does not close #N" now gets a warning, because GitHub still closes #N. The repair and post-merge closing treat that issue as kept open, and the guard refuses a merge that GitHub would use to close it. The post-session link repair and the pre-merge guard now add or require `Fixes` lines only for issues the pull request is meant to close (with #3282). They skip sub-issues that are already closed, sub-issues created after the pull request was opened (a plan's output), and sub-issues another open pull request closes, including PRs stacked on another branch that GitHub does not link, found in all of an issue's cross-references, not only the first 100. They also skip a primary issue that the description marks with "Part of #N", "Towards #N" or "#N stays open", together with its sub-issues, so a tracking umbrella can be solved one sub-issue at a time. Issues listed in a repository-mode block and issues with an explicit closing keyword stay required. The repair removes `Fixes` lines that an earlier repair added for such issues, and the merge guard refuses a merge that GitHub would use to close them.

  Repository mode (`/solve <repository-url>`) no longer selects status pages as work (issue #3176). Open issues opened by a bot (coverage reports, dependency dashboards), issues with a label from the new `--skip-issue-labels` option (default `hive-mind:skip,dashboard,status`, `none` to turn it off) and issues whose body contains `<!-- hive-mind:skip -->` are left out of the combined issue, its sub-issues and its required closing references, so the pull request no longer closes them and their workflow no longer reopens them into the next run. The combined issue and the log list each skipped issue with the reason; `--include-bot-issues` selects bot-authored issues again. A repository whose only open issues are skipped is reported as having no work, and the Telegram preflight applies the same options.

  The Telegram bot no longer blocks its event loop on file or process I/O while it serves commands (issue #3278): the state lock, model catalogue cache, sidecar and CLI-refresh state, session snapshots, router session drain, session-monitor log scans, Formal AI attribution and the Docker launch path (host path probes, host-path preparation, push-guard install) now use async, timeout-bounded calls, and the bot's docker and gh `$` calls are bounded with an AbortSignal. The `hive/require-exec-timeout` lint rule now checks command-stream `$` calls, including a renamed `$` and `quietProbe($)`, and reports a `timeout` option that command-stream ignores, both lint baselines record the reason for every remaining entry with an exact count, and a new watchdog test runs every bot command, `/fix`, `/task`, `/split` and `/terminal_watch` included, against slow stubbed dependencies and fails when the event loop is blocked past its budget. Two waiters that see the same stale state lock break it once and never run together.

  Formal AI now behaves the same through `--tool claude`, `--tool codex` and `--tool agent` (issue #3279): commits made during a Claude Code or Codex CLI session carry the same four Formal-AI trailers and the same evidence bundle (with a `claude-stream.jsonl` or `codex-stream.jsonl` stream) that Agent CLI sessions already had, and the hosted-model guard now checks the model and the generations that really answered instead of rejecting the client name. Prices for models served outside a client's own vendor live in one registry keyed by the served model, so a Formal AI session costs $0.00 (Link.Assistant) in every client, and a non-Anthropic model behind a non-Anthropic `ANTHROPIC_BASE_URL` no longer inherits Claude Code's Anthropic list price.

  A no-change Formal AI run no longer marks its draft pull request "ready for review (solution draft verified)" (issue #3330). If a run's effect cannot be measured (no baseline, unreadable git, or unreadable comments), the pull request keeps the state it had before the run and gets a "Could not verify the session's effect" notice that says why. A Formal AI non-executed terminal state such as `planned_not_executed`, with no commit, now counts as finished without changes (exit code 5) on its own, without reading comments. When `/user` is forbidden to an installation token, the comment author is taken from GraphQL `viewer` (`<app-slug>[bot]`), or `github-actions[bot]` inside GitHub Actions. The readiness gate (`getPullRequestChangeStats`) now ignores `dev/log/**` and AI tool scratch files, using the same predicate as the session verdict. solve no longer announces such a run as SUCCESS, the Formal AI draft and E2E containers receive `GITHUB_ACTIONS`, and the next session on an unverified draft gets its feedback instead of being told the previous session failed.

  The E2E Hello World matrix (issue #3332) now tests the Formal AI version Hive Mind ships (`FORMAL_AI_BOOTSTRAP_VERSION`, cross-checked against the Dockerfile pins) instead of the GitHub Releases `latest`. It records the shipped, GitHub release and crates.io versions in the job summary and the `e2e-matrix-metadata` artifact, and annotates a disagreement between releases and crates.io with a link to formal-ai#1203. Rows on the default `GITHUB_TOKEN` ask for the workflow under `ci/`, which that token can push, and the harness runs it with act. A rejected workflow push is reported as `harness: workflow push rejected (no workflows permission)`, together with the exact secret a maintainer must set. The summary reports the harness verdict apart from the model verdict, and a red Formal AI row links formal-ai#1209 and formal-ai#1154. solve reports the same rejection on the pull request: when GitHub refused a push because the credential may not create or update a workflow file and the workflow is still missing from the pull request, a notice says which credential permission a maintainer must grant, and a rejection a later push recovered from is not reported.

  After a merge, Hive Mind now checks every issue the pull request is meant to close and closes the ones GitHub left open, for example after a merge into a branch other than the default one (issues #3354, #3355 and #3357). It waits up to 5 minutes (checks after 10, 20, 40 and 60 seconds) for GitHub on a default-branch merge, then closes each remaining issue as completed with a comment that names the pull request, the merge commit and why GitHub did not close it. The result appears in the log, in the auto-merge comment and in the Telegram merge queue message. Issues the description keeps open ("does not close", "Part of"), issues only a repair block or a sidebar link names, and deferred sub-issues are never closed. This is on by default; `--no-auto-close-linked-issues` or `HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES=false` only reports the open issues. `/merge`, solve's auto-merge, the merge queue, the merged-PR sweeper and `close-linked-issues` now share this one implementation, which replaces the previous per-path closing code.

  Pull requests merged outside Hive Mind (the GitHub UI, a person's `gh pr merge`, GitHub auto-merge) now get their intended issues closed too (issue #3356). The Telegram bot (your own pull requests) and hive (the monitored repository or owner) run a sweeper every 5 minutes over pull requests merged in the last 24 hours. It skips ones merged in the last 5 minutes, checks each one only once, and stores its cursor in `~/.hive-mind/merged-pr-sweeper.json` (or `HIVE_MIND_MERGED_PR_SWEEPER_STATE`). It never touches pull requests merged before it was first enabled. The new `close-linked-issues --pr <url> [--dry-run]` command does the same for one pull request and prints what it would close and what it skips and why. `close-linked-issues --repo <owner/repo> --since <date>` (or `--owner`) backfills older merges.

  A closing reference to an issue in another repository that the pull request author wrote in the description (above any repair block) no longer blocks the merge, and the issue is closed explicitly after the merge, because GitHub does not close it (issue #3358). Foreign references that the link repair appended, or that come from a sub-issue tree, still block the merge, as in issue #3276. A sidebar-only foreign link still blocks it too. `--no-allow-cross-repository-closing` or `HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING=false` restores the previous rule, which blocks every foreign closing reference.

  After the post-merge check closes an issue, Hive Mind now walks up its parent issues and closes each one whose work is complete (issue #3359). A parent is closed only when four things hold. First, every sub-issue is closed as completed; one closed as not planned or as a duplicate counts only if the parent description says so. Second, the description has no unchecked task-list item and no open "Done when" item. Third, nothing blocks it. Fourth, nobody reopened it after its last sub-issue closed. Otherwise, the parent gets one status comment with the reasons, which is updated instead of repeated. Sub-issues are never closed because their parent closed. This is on by default; turn it off with `--no-close-completed-parents` or `HIVE_MIND_CLOSE_COMPLETED_PARENTS=false`.

  Dependencies are current, and CI demands it everywhere a version is declared (issue #3282). The freshness gate now also checks transitive `package-lock.json` entries that `npm update` would move, images held in Dockerfile `ARG`s or pinned by digest, image references in source code, the coolify Dockerfile and the example workflows users copy. It ignores prose and commented-out lines, and reads every page of a registry's tags. A hold on an older version must name its open follow-up issue, such as link-assistant/router 0.x (#3395). Formal AI stays just another model: `hive` and `solve` also stop an unleased Formal AI sidecar and unload an image unused past `HIVE_MIND_FORMAL_AI_UNLOAD_AFTER`, not only the Telegram bot, and a host that never ran Formal AI makes no Docker call for it. Model validation and the runtime share one list of the tools Formal AI runs through. The Telegram bot treats a command argument as a GitHub URL only when it names the github.com host, and the merge queue's MarkdownV2 escaping covers backslashes, also in its CI run links. Claude Code now receives the system prompt, and a resumed session's prompt, exactly as written. Before, every `"` in them arrived as `\"`, and with command-stream 0.18.0 /bin/sh expanded their `$(...)` and backticks: every run logged `/bin/sh: 1: .png: not found`. The command Hive Mind logs (and `--dry-run` returns) is now quoted so that it runs as shown. Tests replay commands through the command-stream version production pins (2.4.0, now a devDependency). The 0.17.2 copy that agent-commander 0.11.0 brought in split a command at a quoted `|` after an apostrophe. This was reported upstream as link-assistant/agent-commander#53, and agent-commander 0.11.1 fixes it by moving to command-stream 2.4.0, so only one copy remains.

## 2.37.0

### Minor Changes

- 8f1906a: `/fix --ci-cd` and `/fix --update-all-dependencies` no longer create duplicate issues and wait for default-branch CI/CD before the task starts (#3326):

  - Issue creation checks which issue types the repository supports before passing `--type` (user-owned repositories have none), and when `gh issue create` fails it first looks for the issue it may already have created instead of blindly retrying. `gh` 2.102.0 creates the issue and only then fails with `type "Bug" not found`, which used to produce a second, label-less issue (reported upstream as cli/cli#14703).
  - `/fix` creates the issue right away, then waits for running CI/CD on the default branch to finish (polling every 30 s, `--ci-wait-timeout <minutes>`, default 60; `--no-wait-for-ci` to skip) and comments the final results on the issue before `/solve` starts.
  - Telegram shows the separate "⏳ Waiting for CI/CD on `main` to finish" status with the running workflows and elapsed time, then the CI result and the issue link (en/ru/zh/hi).

## 2.36.1

### Patch Changes

- 35bdc2d: The post-session link repair no longer adds `Fixes` lines for sub-issues the pull request description keeps open ("Part of #7", "#236 to #246 stay open"), together with their own sub-issues, or for sub-issues in other repositories, and it removes such lines that an earlier repair added (issues #3174 and #3276). Before any merge, hive-mind now refuses a pull request that GitHub would use to close an issue in another repository, or an issue the description keeps open, for example through "does not close #7", which GitHub still closes.

## 2.36.0

### Minor Changes

- 20ed4dd: Cap a Docker task container to 2 CPUs once it has kept all of its CPUs busy for 15 minutes, and lift the cap after it averages below 65% of the cap for 15 minutes (issue #2801). This is on by default for `--isolation docker`. It is configurable with `--container-cpu-penalty-*` / `TELEGRAM_CONTAINER_CPU_PENALTY_*`, and `--no-container-cpu-penalty` turns it off.

  The dependency freshness gate now checks the Formal AI pin against crates.io, the registry `cargo install` pulls it from, instead of GitHub tags: v0.353.0 was tagged but never published there.

## 2.35.10

### Patch Changes

- f8922ed: Make `/claude`, `/codex` and `/agent` with `--model formal-ai` reliable end to end:

  - The Telegram bot keeps answering every chat while a command prepares its task (for example while a Formal AI image is pulled). Slow command work (the launch commands, `/models`, `/auth`, `/log`, `/stop`, `/terminal_watch`, `/limits`, `/version`) runs outside the update loop, logs are written asynchronously, `gh` calls have a timeout (`HIVE_MIND_GITHUB_EXEC_TIMEOUT_MS`), and lint rules keep blocking calls out of the bot process.
  - A run that changed nothing finishes with ⚠️ "Finished without changes" and exit code 5 instead of 🎉 (the queue and Docker monitor do not count it as a failure; `HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE=0` keeps exit 0), keeps a draft PR in draft, and reports a session that looped on one command. An echoed tool output is no longer posted as the working-session summary.
  - Telegram alias session recovery executes the real solve command, keeps resume hints, and reports, cleans up and retries snapshot recoveries that fail to start, on the issue when there is no pull request.
  - Docker sessions are only reported as finished after their container was observed (or the launch failed), and an unknown exit code is shown as "status unknown" instead of success. `start-screen` sessions record their exit status.
  - Formal AI images are resolved local-first, an accepted fallback image is reused instead of re-pulled, a timed-out pull keeps running detached instead of leaving a containerd lease, and sidecar leases survive while their session or its launcher is alive.
  - Codex runs against Formal AI keep a pinned `CODEX_HOME` and config across restarts and classify Formal AI failures.
  - Formal AI has the same two spellings on every tool (Codex no longer accepts `openai/formal-ai`, which ran against OpenAI), and `hive` validates it like `solve`.
  - A submitted PR review counts as progress, unreadable comments are not "no comment", and a Codex usage limit reported in a stream error is detected.
  - Recoverable agent tool errors no longer abort the run.
  - The DinD image clears stale `dockerd`/`containerd` pid files before starting.
  - Formal AI draft runs report their checks on the draft head, keep tool state between iterations, and can be called from other repositories.
  - `npm run lint` fails on any warning.
  - Pinned versions: `@link-assistant/agent` 0.26.15, `start-command` 0.37.8, Node.js 26.12.0, `formal-ai` 0.353.2, `@dotenvx/dotenvx` 2.35.0.

## 2.35.9

### Patch Changes

- f0b34db: Every original `solve` option now survives the auto-resume/auto-restart relaunch after a usage-limit reset. Previously, the relaunch rebuilt its command line from a short allowlist, so `--auto-merge`, `--think`, `--language`, `--disable-report-issue`, `--no-tool-check` and every other option were silently dropped. Forwarding now goes through one definition-driven mechanism (`src/cli-option-forwarding.lib.mjs`), which is also used for the printed manual-resume commands, the "did you mean the issue?" suggestion and hive → solve. An explicit `--model sonnet` is no longer lost on resume, an implicit fallback model is no longer pinned, and hive no longer forwards the internal `--previous-anthropic-cost` (#3190).

  Docker images install Formal AI 0.353.1, `@link-assistant/agent` 0.26.13 and start-command 0.37.5; command-stream is pinned to 2.4.0, links-notation to 0.26.0, Sentry to 11.7.0 and eslint-plugin-prettier to 5.5.7.

## 2.35.8

### Patch Changes

- 58073a1: Fix `/queue` status accuracy (issue #2823): tasks that are still running are no
  longer listed under Completed, queued tasks that fail after launch (non-zero
  exit or kill) now move to Failed with their exit code or signal, the summary
  counts come from the lists shown (`Pending, Processing, Completed, Failed`),
  long replies repeat the tool and list headers in every continuation message,
  and bare repository URLs render as `owner/repo` links.

  Docker images build on Box 2.10.4; command-stream is pinned to 2.3.0 and
  lino-objects-codec is 0.9.2.

## 2.35.7

### Patch Changes

- ed0e1e7: `/solve <repository-url>` on a repository with exactly one open issue now solves that issue directly, as if its URL had been given, instead of creating a combined issue whose only sub-issue is that same issue. The Telegram bot shows and launches the issue URL in that case (#3108).

  Docker images install start-command 0.37.1; lino-objects-codec is 0.9.1.

## 2.35.6

### Patch Changes

- a785441: Stop reporting successful Claude sessions as "Solution Draft Failed" when the
  CLI does not exit after its result. The solver stops such a CLI itself after
  30 seconds (Issue #1280), and command-stream 0.12+ reports that as an exit chunk
  with code 143. That code was counted as a failure, and the AI's own work summary
  was published as the error ("CLAUDE execution failed with I fixed the four…"),
  turning a ready PR back into a draft. Both exit paths now share one rule. A tool's
  work summary is never published as a failure reason for any tool, and the
  SIGKILL follow-up is sent while the CLI's process group is still alive.

  The post-result close timeout now follows Claude Code's background tasks. In
  every reported run, print mode was still waiting for a CI or test waiter task
  when the 30-second timer stopped it. While background tasks run, the solver now
  waits up to Claude Code's own print-mode wait ceiling. It pauses the timer when
  a finished task starts another turn, and logs which tasks it is waiting for. A
  CLI with nothing pending is still stopped after 30 seconds.

  command-stream is pinned to 2.1.0 for the dependency freshness gate.

## 2.35.5

### Patch Changes

- ab70b10: `--auto-restart-until-mergeable` no longer spends every restart on sessions that only reword the same report of a CI blocker (#2839). The no-progress check between AI sessions now compares only the commit and the working tree, so a reworded final message no longer counts as progress. Restarts for failing CI now ask the AI to fix every failing check, including checks that already fail on the default branch, because a pull request with failing CI cannot be released. When a check needs a human action, such as a missing secret or access to a private submodule, the AI is told to make the pull request's CI pass without it and to make CI on the default branch fail with an explicit message saying what a human has to do. When a failing check also fails on the head of the base branch or on the solver's placeholder commit, the prompt includes links to those runs as evidence. The system prompts of every tool now say the same when they ask for passing CI before finishing. A new human comment also skips the no-progress check in `--watch` mode, as it already did in `--auto-restart-until-mergeable`.

  Dependencies refreshed for the freshness gate: Bun 1.4.3 and start-command 0.37.0 (Docker images), prettier 3.9.10, and the use-m pins command-stream 2.0.2 and links-notation 0.25.2.

## 2.35.4

### Patch Changes

- 37b71de: Support the obvious "latest version" alias of every model family (issue #2591): `--model astra` now resolves to the newest GPT Astra and `sol` to GPT-6.1 Sol. The aliases (`astra`/`sol`/`luna`/`terra`/`daybreak-*` for codex, `opus`/`sonnet`/`haiku`/`fable`/`mythos` and `opus-5.5`-style spellings for claude, `max`/`plus`/`flash` for qwen) are derived from model names, including those the installed Codex CLI reports, so new families need no code change. The "Available models" listings now show what each CLI currently offers instead of obsolete and `openai.`-prefixed entries (codex: 62 → 13). Gemini uses its CLI's rolling `flash`/`pro`/`auto` aliases, Qwen accepts `coder-model`, agent and opencode map premium aliases to the newest Claude and Gemini models, and opencode defaults to `big-pickle` because `grok-code` is deprecated. Set `HIVE_MIND_MODEL_DEBUG=1` (or `--verbose`) to trace how a `--model` value was resolved.

## 2.35.3

### Patch Changes

- 3675177: Name the model that actually ran in failure comments and choose the fallback
  from it. Claude's `system/init` and assistant `message.model` IDs are recorded
  as the stream arrives, so a session that crashed, was killed or ended with an
  error before its `result` event still reports `claude-opus-5-5` instead of the
  bundled alias mapping. When no actual model is known the comment says
  "Requested (actual model unknown — session ended before result)" instead of
  presenting the alias mapping as the model. Retries pick the default fallback
  from the reported model, so `claude-opus-5-5` steps down to `opus-5` instead of
  skipping to `opus-4-8`.

## 2.35.2

### Patch Changes

- a033296: Fix CI/CD false negatives found in issue #2923: post-publish verification now waits up to 25 minutes for npm to expose a version (2.35.1 took 874s, more than the old 330s window), treats `E409 Cannot publish over previously staged version` as already published, and keeps its registry probes quiet unless `HIVE_MIND_PUBLISH_VERBOSE=true`. The release gate now also releases a version that reached npm without a GitHub release, so its Docker images and Helm chart are produced. The E2E matrix explains why it skipped, and the agent no longer logs "recovered" for an error that still fails the run. The `--verbose` leftover-process check no longer warns about the task-owned `formal-ai serve`, which Hive Mind keeps for later sessions and stops at exit.

  Dependencies refreshed for the freshness gate: start-command 0.36.0 (Docker images), lino-i18n 0.4.0, jscpd 5.4.1, and the use-m pins @dotenvx/dotenvx 2.34.2 and links-notation 0.25.1.

## 2.35.1

### Patch Changes

- 4a562ed: Use the cheapest pricing tier by default for every tool (issue #2771): short context (Claude 200K / Haiku 5.5 100K, Codex 272K, Gemini Pro 200K, Qwen 256K) unless `--sub-session-size` explicitly asks for more, standard speed (no Fast/priority/Ultrafast) via the new `--speed` option (`--speed flex`, alias `batch`, opts into OpenAI's half-price Flex tier), plain model names instead of `[1m]`, and `opus`/`sonnet`/`haiku` aliases now map to the latest and cheapest Claude 5.5 models while all pinned versions stay supported.

## 2.35.0

### Minor Changes

- 183d6aa: Enable dependency issue reporting by default with --update-all-dependencies, and
  add --report-dependencies-issues for independent control. Generated dependency
  issues and all solver tools ask for upstream reports of shared logic, duplicated
  code, missing features and bugs requiring workarounds, while allowing local
  workarounds to keep the pull request moving. Preserve explicit opt-outs through
  /fix and Telegram /task issue generation and solve handoffs.

  Refresh the paired Sentry SDK packages to 11.6.0 to satisfy the dependency
  freshness gate after the new upstream release.

## 2.34.3

### Patch Changes

- 96394c9: Report Codex process exit codes, signals, plain CLI errors, and fresh cgroup OOM evidence in failure messages. Preserve termination metadata for existing SIGKILL recovery and provide the container memory budget to Codex before execution.

  Refresh the regular, DinD and Coolify Box base images to 2.10.3 to satisfy dependency freshness after its release during validation.

## 2.34.2

### Patch Changes

- c21ccd1: Report hive runs that process no issues or leave blocked work as warnings with distinct nonzero exit codes. Keep skipped issues separate from completed work, surface discovery failures and existing PR links, and honor deprecated tool-check switches.

  Keep sub-issues eligible when a parent's PR also references them, in both batch discovery and worker rechecks, including the REST fallback. Preserve parent-last dependency scheduling when including existing PRs and suggest --no-skip-issues-with-prs --auto-continue when no eligible issues remain, including translated Telegram warnings.

## 2.34.1

### Patch Changes

- feca4bc: Preserve Claude provider errors and usage-limit reset information when an earlier tool command failed, including streams without a final newline. Prevent background-task continuation of error results and include the file utility in all task images for attachment validation.

## 2.34.0

### Minor Changes

- 0307dcd: `hive` now respects GitHub sub-issues and issue dependencies (#2615). It only queues issues that have no open "blocked by" issues (their own or inherited from a parent issue) and no open sub-issues, and starts the issue that unblocks the longest chain of work first, so `--concurrency` runs exactly the issues that can be worked on in parallel. Waiting issues are listed with the reason, dependency cycles are reported, and a worker rechecks relations right before it starts an issue. With `--once`, hive checks again for newly unblocked issues while work keeps completing (for example with `--auto-merge`). `hive https://github.com/owner/repo/issues` is now accepted as the repository URL. Use `--no-respect-issue-relations` to queue every matching issue at once as before.

## 2.33.17

### Patch Changes

- 33e3a76: Bound version probes and clean up their descendants even when diagnostic callbacks fail. Preserve complete sanitized failed-session logs on verified pull request branches when Gist permissions are unavailable, honor log directories before argument parsing, retain Formal AI development logs, and tolerate simultaneous creation of the draft label.

## 2.33.16

### Patch Changes

- 3ad8eb4: Identify the offending URL segment or argument in input validation errors (with a compiler-style caret under URL typos, bold and in a code block on Telegram), suggest likely URL path and host corrections as natural questions, and stop solve on invalid options.

## 2.33.15

### Patch Changes

- fe9650e: Fix the CI/CD false negatives found on `main` (issue #2625). The dependency-freshness gate now blocks pull requests only and warns on pushes. The fixture cleanup reports ruleset-retained branches as retained, not as errors. `release.yml` can be dispatched with `mode=checks` alone. The Formal AI draft creates its label when it is missing. Log uploads no longer retry a token that cannot create gists. `solve --log-dir` now actually writes the session log into that directory. The default Agent model moves from the withdrawn `opencode/nemotron-3-super-free` to `kilo/nemotron-3-super-free`. Result verification works with integration tokens and prints the real failure reason. Command-stream is bumped to 2.0.0, Sentry to 11.5.0, agent-commander to 0.11.0 and the image Node.js to 26.11.0.
- 3031ced: A pull request URL whose branch names an issue from another repository (such as `issue-320-…` created while solving `link-assistant/agent#320`) now uses the issue its description closes. Before, every pre-merge gate looked for the missing issue and held back `--auto-merge`. A held-back auto-merge no longer attaches a log that is already attached. AI work that is not attached yet is posted together with the held-back notice in one comment. Every solution draft log comment, for all tools, now shows cost estimation, context and tokens usage and models used (#2563).
- 957e1ea: Stop appending a generated "Changes" section (file and line counts, file list) to a pull request description after the agent has written it, on both normal completion and restarts. Missing issue-closing links are still appended, now after a separator. The initial placeholder description and its replacement when the agent never updated it are unchanged.

