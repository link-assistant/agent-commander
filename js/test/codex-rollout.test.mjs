/**
 * Codex rollouts: resume check (hive-mind#2888) and the usage-limit
 * cross-check of a failed exit (hive-mind#3570; issue #55).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  applyCodexRolloutUsageLimit,
  canResumeCodexSession,
  classifyCodexRateLimitSnapshot,
  codexSessionsDir,
  codexRolloutLimitFacts,
  detectCodexRolloutUsageLimit,
  findCodexRolloutFile,
  isCodexRolloutFileName,
  readCodexRolloutLimitFacts,
} from '../src/index.mjs';

const THREAD = '019a2b3c-4d5e-7f60-8a9b-0c1d2e3f4a5b';
const RESETS_AT = 1798761600; // Jan 1, 2027, 12:00 AM UTC

const line = (payload) =>
  JSON.stringify({
    timestamp: '2026-10-21T00:00:00Z',
    type: 'event_msg',
    payload,
  });
const tokenCount = (usedPercent) =>
  line({
    type: 'token_count',
    rate_limits: {
      primary: {
        used_percent: usedPercent,
        window_minutes: 300,
        resets_at: RESETS_AT,
      },
      secondary: {
        used_percent: 40,
        window_minutes: 10080,
        resets_at: RESETS_AT + 86400,
      },
    },
  });

let codexHome;

const writeRollout = async (lines, threadId = THREAD) => {
  const dir = join(codexHome, 'sessions', '2026', '10', '21');
  await mkdir(dir, { recursive: true });
  const file = join(dir, `rollout-2026-10-21T00-00-00-${threadId}.jsonl`);
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
};

before(async () => {
  codexHome = await mkdtemp(join(tmpdir(), 'agent-commander-codex-home-'));
});

after(async () => {
  await rm(codexHome, { recursive: true, force: true });
});

test('codexSessionsDir reads the home directory only without CODEX_HOME', () => {
  // Deno denies os.homedir() without --allow-sys=homedir, so an explicit
  // CODEX_HOME must not touch it.
  assert.strictEqual(
    codexSessionsDir({ codexHome: '/c', homeDir: '/unused' }),
    join('/c', 'sessions')
  );
  assert.strictEqual(
    codexSessionsDir({ codexHome: '', homeDir: '/home/u' }),
    join('/home/u', '.codex', 'sessions')
  );
});

test('isCodexRolloutFileName matches the thread suffix only', () => {
  assert.ok(
    isCodexRolloutFileName(
      `rollout-2026-10-21T00-00-00-${THREAD}.jsonl`,
      THREAD
    )
  );
  assert.ok(!isCodexRolloutFileName(`rollout-x-${THREAD}.json`, THREAD));
  assert.ok(!isCodexRolloutFileName(`other-${THREAD}.jsonl`, THREAD));
});

test('canResumeCodexSession finds a rollout and rejects a missing one', async () => {
  const file = await writeRollout([line({ type: 'task_started' })]);
  assert.strictEqual(
    await findCodexRolloutFile({
      sessionsDir: join(codexHome, 'sessions'),
      threadId: THREAD,
    }),
    file
  );
  assert.strictEqual(
    await canResumeCodexSession({ threadId: THREAD, codexHome }),
    true
  );
  assert.strictEqual(
    await canResumeCodexSession({ threadId: 'missing-thread-0000', codexHome }),
    false
  );
  // Ids that are not thread-shaped never reach the file system walk.
  assert.strictEqual(
    await canResumeCodexSession({ threadId: '../x', codexHome }),
    false
  );
  assert.strictEqual(
    await canResumeCodexSession({ threadId: null, codexHome }),
    false
  );
});

test('classifyCodexRateLimitSnapshot needs 100% with a reset', () => {
  const reached = classifyCodexRateLimitSnapshot({
    primary: { used_percent: 100, window_minutes: 300, resets_at: RESETS_AT },
    rate_limit_reached_type: 'primary',
  });
  assert.strictEqual(reached.reached, true);
  assert.strictEqual(reached.window, '5-hour');
  assert.strictEqual(reached.resetsAt, RESETS_AT);
  assert.strictEqual(reached.resetTime, 'Jan 1, 2027, 12:00 AM');
  assert.strictEqual(reached.timezone, 'UTC');

  const noReset = classifyCodexRateLimitSnapshot({
    primary: { used_percent: 100 },
    rate_limit_reached_type: 'primary',
  });
  assert.strictEqual(noReset.reached, false);
  assert.match(noReset.reason, /peak used_percent 100/);
  assert.strictEqual(classifyCodexRateLimitSnapshot(null).reached, false);
});

test('codexRolloutLimitFacts reads only the last turn', () => {
  const facts = codexRolloutLimitFacts(
    [
      tokenCount(100),
      line({
        type: 'error',
        message: "You've hit your usage limit",
        codex_error_info: 'usage_limit_exceeded',
      }),
      line({ type: 'task_started' }),
      tokenCount(55),
      'not json',
    ].join('\n')
  );
  assert.strictEqual(facts.rateLimits.primary.used_percent, 55);
  assert.strictEqual(facts.errorText, null);
});

test('readCodexRolloutLimitFacts reads a bounded tail', async () => {
  await writeRollout([
    line({ type: 'task_started' }),
    'x'.repeat(4096),
    tokenCount(100),
  ]);
  const facts = await readCodexRolloutLimitFacts({
    threadId: THREAD,
    codexHome,
    maxBytes: 1024,
  });
  assert.strictEqual(facts.found, true);
  assert.strictEqual(facts.rateLimits.primary.used_percent, 100);
  const missing = await readCodexRolloutLimitFacts({
    threadId: 'missing-thread-0000',
    codexHome,
  });
  assert.strictEqual(missing.found, false);
});

test('detectCodexRolloutUsageLimit uses rate_limits, then the error event', async () => {
  await writeRollout([line({ type: 'task_started' }), tokenCount(100)]);
  const fromSnapshot = await detectCodexRolloutUsageLimit({
    threadId: THREAD,
    codexHome,
  });
  assert.strictEqual(fromSnapshot.reached, true);
  assert.strictEqual(fromSnapshot.resetsAt, RESETS_AT);

  await writeRollout([
    line({ type: 'task_started' }),
    line({
      type: 'error',
      message: 'stream error',
      codex_error_info: { usage_limit_exceeded: {} },
    }),
  ]);
  const fromError = await detectCodexRolloutUsageLimit({
    threadId: THREAD,
    codexHome,
  });
  assert.strictEqual(fromError.reached, true);
  assert.strictEqual(fromError.resetsAt, null);

  await writeRollout([line({ type: 'task_started' }), tokenCount(20)]);
  const none = await detectCodexRolloutUsageLimit({
    threadId: THREAD,
    codexHome,
  });
  assert.strictEqual(none.reached, false);
});

test('applyCodexRolloutUsageLimit only fills failed, unsignalled Codex runs', async () => {
  await writeRollout([line({ type: 'task_started' }), tokenCount(100)]);
  const base = {
    tool: 'codex',
    exitCode: 1,
    signal: null,
    success: false,
    limitReached: false,
    sessionId: THREAD,
  };
  const filled = await applyCodexRolloutUsageLimit({ ...base }, { codexHome });
  assert.strictEqual(filled.limitReached, true);
  assert.strictEqual(filled.limitSource, 'codex-rollout');
  assert.strictEqual(filled.limitWindow, '5-hour');

  for (const skipped of [
    { ...base, signal: 'SIGTERM' },
    { ...base, exitCode: 0, success: true },
    { ...base, tool: 'claude' },
    { ...base, sessionId: null },
  ]) {
    const result = await applyCodexRolloutUsageLimit(
      { ...skipped },
      { codexHome }
    );
    assert.strictEqual(result.limitReached, false, JSON.stringify(skipped));
    assert.strictEqual(result.limitSource, undefined);
  }
});

test(
  'agent().stop() reports a usage limit found only in the Codex rollout',
  { skip: process.platform === 'win32', timeout: 15000 },
  async () => {
    await writeRollout([line({ type: 'task_started' }), tokenCount(100)]);
    const binDir = await mkdtemp(join(tmpdir(), 'agent-commander-fake-codex-'));
    const originalPath = process.env.PATH;
    try {
      const script = join(binDir, 'codex');
      await writeFile(
        script,
        `#!/usr/bin/env bash
echo '${JSON.stringify({ type: 'thread.started', thread_id: THREAD })}'
echo 'Codex command failed' >&2
exit 1
`
      );
      await chmod(script, 0o755);
      process.env.PATH = `${binDir}:${originalPath}`;
      const controller = agent({
        tool: 'codex',
        workingDirectory: tmpdir(),
        prompt: 'hi',
        json: true,
        toolOptions: { extraEnv: { CODEX_HOME: codexHome } },
      });
      await controller.start({ attached: false });
      const result = await controller
        .stop()
        .catch((error) => error.result ?? { error });
      const metadata = result.metadata ?? result.error?.metadata;
      assert.ok(metadata, String(result.error));
      assert.strictEqual(metadata.sessionId, THREAD);
      assert.strictEqual(metadata.success, false);
      assert.strictEqual(metadata.limitReached, true);
      assert.strictEqual(metadata.limitSource, 'codex-rollout');
      assert.strictEqual(metadata.limitResetsAt, RESETS_AT);
    } finally {
      process.env.PATH = originalPath;
      await rm(binDir, { recursive: true, force: true });
    }
  }
);
