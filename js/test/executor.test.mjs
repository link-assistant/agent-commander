/**
 * Process exit and termination behaviour ported from Hive Mind
 * (hive-mind#3015 process-group checks, codex.process-exit signal mapping;
 * issue #55).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { execFileSync } from 'node:child_process';
import {
  executeCommand,
  isProcessGroupAlive,
  normalizeExit,
  signalFromExitCode,
  startCommand,
} from '../src/executor.mjs';

const unix = { skip: process.platform === 'win32', timeout: 15000 };

// Live (non-zombie) members of a process group. A killed orphan stays a
// zombie until its new parent reaps it, and some container inits never do.
function liveGroupMembers(pgid) {
  return execFileSync('ps', ['-A', '-o', 'pgid=,stat='], { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim().split(/\s+/))
    .filter(
      ([group, stat]) => Number(group) === pgid && !stat?.startsWith('Z')
    );
}

async function groupGone(pgid, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (liveGroupMembers(pgid).length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  return liveGroupMembers(pgid).length === 0;
}

test('normalizeExit - a signal becomes 128 + N and 128 + N names the signal', () => {
  assert.deepStrictEqual(normalizeExit({ code: null, signal: 'SIGKILL' }), {
    exitCode: 137,
    signal: 'SIGKILL',
  });
  assert.deepStrictEqual(normalizeExit({ code: 143 }), {
    exitCode: 143,
    signal: 'SIGTERM',
  });
  assert.deepStrictEqual(normalizeExit({ code: 2 }), {
    exitCode: 2,
    signal: null,
  });
  assert.deepStrictEqual(normalizeExit({ code: null }), {
    exitCode: 1,
    signal: null,
  });
  assert.strictEqual(signalFromExitCode(130), 'SIGINT');
  assert.strictEqual(signalFromExitCode(128), null);
});

test('isProcessGroupAlive - EPERM counts as alive, ESRCH as gone', () => {
  const failWith = (code) => () => {
    throw Object.assign(new Error(code), { code });
  };
  assert.strictEqual(
    isProcessGroupAlive(42, () => true),
    process.platform !== 'win32'
  );
  assert.strictEqual(isProcessGroupAlive(42, failWith('ESRCH')), false);
  assert.strictEqual(
    isProcessGroupAlive(42, failWith('EPERM')),
    process.platform !== 'win32'
  );
});

test(
  'executeCommand - a killed shell reports exit 137 and SIGKILL',
  unix,
  async () => {
    const result = await executeCommand('kill -9 $$', { attached: false });
    assert.strictEqual(result.exitCode, 137);
    assert.strictEqual(result.signal, 'SIGKILL');
  }
);

test(
  'executeCommand - a pipeline exit of 143 names SIGTERM',
  unix,
  async () => {
    const result = await executeCommand('exit 143', { attached: false });
    assert.strictEqual(result.exitCode, 143);
    assert.strictEqual(result.signal, 'SIGTERM');
  }
);

test(
  'startCommand - a grandchild holding stdout cannot hang waitForExit',
  unix,
  async () => {
    const started = Date.now();
    const handle = await startCommand('(sleep 30 &); echo done', {
      attached: false,
      pipeDrainMs: 200,
    });
    const exitCode = await handle.waitForExit();
    assert.strictEqual(exitCode, 0);
    assert.ok(handle.getOutput().stdout.includes('done'));
    assert.ok(Date.now() - started < 5000, 'resolved after the drain bound');
    assert.ok(await groupGone(handle.process.pid));
  }
);

test(
  'terminate - signals the group even after the wrapper shell exited',
  unix,
  async () => {
    const handle = await startCommand('(sleep 30 &); exit 0', {
      attached: false,
      pipeDrainMs: null,
    });
    await new Promise((resolve) => handle.process.once('exit', resolve));
    assert.strictEqual(isProcessGroupAlive(handle.process.pid), true);
    assert.strictEqual(handle.terminate(), true);
    const started = Date.now();
    await handle.waitForExit();
    assert.ok(Date.now() - started < 5000);
    assert.ok(await groupGone(handle.process.pid));
  }
);

test(
  'terminate - escalates to SIGKILL when SIGTERM is ignored',
  unix,
  async () => {
    const handle = await startCommand("trap '' TERM; sleep 30 & wait", {
      attached: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
    handle.terminate('SIGTERM', { killAfterMs: 300 });
    const exitCode = await handle.waitForExit();
    assert.strictEqual(exitCode, 137);
    assert.strictEqual(handle.getOutput().signal, 'SIGKILL');
  }
);
