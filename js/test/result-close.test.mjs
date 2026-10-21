/**
 * A process that outlives its result is closed and still judged by that
 * result (hive-mind#1280, #3015; issue #55). A fake `claude` on PATH prints a
 * stream-json turn and then keeps running.
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { agent } from '../src/index.mjs';

const unix = { skip: process.platform === 'win32', timeout: 15000 };
let binDir;
const originalPath = process.env.PATH;

const events = {
  init: { type: 'system', subtype: 'init', model: 'claude-opus-5-5' },
  assistant: {
    type: 'assistant',
    message: {
      model: 'claude-opus-5-5',
      content: [{ type: 'text', text: 'Done' }],
    },
  },
  task: {
    type: 'system',
    subtype: 'task_started',
    task_id: 't1',
    task_type: 'local_bash',
    is_backgrounded: true,
  },
  result: {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Done',
    session_id: 's-1',
  },
};

before(async () => {
  binDir = await mkdtemp(join(tmpdir(), 'agent-commander-fake-claude-'));
  const script = join(binDir, 'claude');
  // FAKE_CLAUDE_EVENTS names the events to print; the process then lingers.
  await writeFile(
    script,
    `#!/usr/bin/env bash
for name in $FAKE_CLAUDE_EVENTS; do
  case "$name" in
${Object.entries(events)
  .map(([name, value]) => `    ${name}) echo '${JSON.stringify(value)}' ;;`)
  .join('\n')}
  esac
done
sleep 30
`
  );
  await chmod(script, 0o755);
  process.env.PATH = `${binDir}:${originalPath}`;
});

after(async () => {
  process.env.PATH = originalPath;
  delete process.env.FAKE_CLAUDE_EVENTS;
  await rm(binDir, { recursive: true, force: true });
});

const startFake = async (names) => {
  process.env.FAKE_CLAUDE_EVENTS = names;
  const controller = agent({
    tool: 'claude',
    workingDirectory: tmpdir(),
    prompt: 'hi',
    json: true,
  });
  await controller.start({ attached: false });
  return controller;
};

test(
  'stop({closeTimeoutMs}) closes a lingering process after a successful result',
  unix,
  async () => {
    const controller = await startFake('init assistant result');
    const started = Date.now();
    const result = await controller.stop({ closeTimeoutMs: 200 });
    assert.ok(Date.now() - started < 5000);
    assert.strictEqual(result.metadata.terminatedAfterResult, true);
    assert.strictEqual(result.metadata.success, true);
    assert.strictEqual(result.metadata.signal, 'SIGTERM');
    assert.deepStrictEqual(result.metadata.observedModels, ['claude-opus-5-5']);
  }
);

test(
  'stop({backgroundWaitMs}) reports background tasks it had to stop',
  unix,
  async () => {
    const controller = await startFake('init assistant task result');
    const result = await controller.stop({
      closeTimeoutMs: 100,
      backgroundWaitMs: 200,
    });
    assert.strictEqual(result.metadata.terminatedAfterResult, true);
    assert.strictEqual(result.metadata.success, false);
    assert.strictEqual(result.metadata.errorType, 'background_tasks_stopped');
    assert.strictEqual(result.metadata.backgroundTasksStopped, 1);
  }
);

test('cancel() after a successful result keeps the success', unix, async () => {
  const controller = await startFake('init assistant result');
  const deadline = Date.now() + 5000;
  while (controller.getMessages().length < 3 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  const result = await controller.cancel();
  assert.strictEqual(result.metadata.terminatedAfterResult, true);
  assert.strictEqual(result.metadata.success, true);
});

test('cancel() before the result is a failure', unix, async () => {
  const controller = await startFake('init assistant');
  await new Promise((resolve) => setTimeout(resolve, 200));
  const result = await controller.cancel();
  assert.strictEqual(result.metadata.terminatedAfterResult, false);
  assert.strictEqual(result.metadata.success, false);
  assert.strictEqual(result.metadata.signal, 'SIGTERM');
  assert.strictEqual(result.metadata.errorType, 'signal');
});
