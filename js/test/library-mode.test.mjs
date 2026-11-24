/**
 * Library-mode safety: signal handling (issue #59) and keeping secrets and
 * large values off the command line (issue #60).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  buildChildEnvironment,
  setupSignalHandler,
  signalExitCode,
} from '../src/index.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';
const onLinux = process.platform === 'linux' && !isDeno;

/**
 * Fake runtime that records what the signal handler does.
 * @returns {Object} Runtime hooks plus recorded state
 */
function fakeRuntime() {
  const listeners = new Map();
  const runtime = {
    reraised: [],
    hostListeners: 0,
    on: (signal, handler) => {
      listeners.set(signal, [...(listeners.get(signal) ?? []), handler]);
    },
    off: (signal, handler) => {
      listeners.set(
        signal,
        (listeners.get(signal) ?? []).filter((h) => h !== handler)
      );
    },
    listenerCount: (signal) =>
      (listeners.get(signal)?.length ?? 0) + runtime.hostListeners,
    log: () => {},
    error: () => {},
    reraise: (signal) => runtime.reraised.push(signal),
    emit: async (signal) => {
      await Promise.all((listeners.get(signal) ?? []).map((h) => h(signal)));
      await new Promise((resolve) => setTimeout(resolve, 10));
    },
    count: (signal) => listeners.get(signal)?.length ?? 0,
  };
  return runtime;
}

test('signalExitCode follows the 128 + N convention', () => {
  assert.strictEqual(signalExitCode('SIGINT'), 130);
  assert.strictEqual(signalExitCode('SIGTERM'), 143);
});

test('setupSignalHandler shares one listener across concurrent runs', () => {
  const runtime = fakeRuntime();
  const removers = Array.from({ length: 20 }, () =>
    setupSignalHandler(() => {}, runtime)
  );
  assert.strictEqual(runtime.count('SIGINT'), 1);
  assert.strictEqual(runtime.count('SIGTERM'), 1);
  for (const remove of removers) {
    remove();
  }
  assert.strictEqual(runtime.count('SIGINT'), 0);
  assert.strictEqual(runtime.count('SIGTERM'), 0);
});

test('setupSignalHandler re-raises the signal instead of exiting 0', async () => {
  const runtime = fakeRuntime();
  const cleaned = [];
  setupSignalHandler(() => cleaned.push('a'), runtime);
  setupSignalHandler(() => cleaned.push('b'), runtime);
  await runtime.emit('SIGTERM');
  assert.deepStrictEqual(cleaned.sort(), ['a', 'b']);
  assert.deepStrictEqual(runtime.reraised, ['SIGTERM']);
  assert.strictEqual(runtime.count('SIGTERM'), 0);
});

test('setupSignalHandler leaves shutdown to a host that listens', async () => {
  const runtime = fakeRuntime();
  runtime.hostListeners = 1;
  let cleaned = false;
  setupSignalHandler(() => {
    cleaned = true;
  }, runtime);
  await runtime.emit('SIGTERM');
  assert.strictEqual(cleaned, true);
  assert.deepStrictEqual(runtime.reraised, []);
});

test('buildChildEnvironment: inherit, allowlist, replacement and extraEnv', () => {
  const parentEnv = { PATH: '/bin', HOME: '/h', DB_PASSWORD: 'pw' };
  assert.deepStrictEqual(
    buildChildEnvironment({ parentEnv, extraEnv: { DB_PASSWORD: null } }),
    { PATH: '/bin', HOME: '/h' }
  );
  assert.deepStrictEqual(
    buildChildEnvironment({
      parentEnv,
      inheritEnv: ['PATH', 'MISSING'],
      extraEnv: { KEY: 'v' },
    }),
    { PATH: '/bin', KEY: 'v' }
  );
  assert.deepStrictEqual(
    buildChildEnvironment({ parentEnv, inheritEnv: false }),
    {}
  );
  assert.deepStrictEqual(
    buildChildEnvironment({ parentEnv, env: { ONLY: '1' } }),
    { ONLY: '1' }
  );
  assert.throws(() => buildChildEnvironment({ inheritEnv: ['bad-name'] }));
  assert.throws(() => buildChildEnvironment({ inheritEnv: 'yes' }));
});

/**
 * Install a fake `claude` that records the wrapper shell's command line, its
 * own argv, the system prompt file and its environment.
 * @param {Object} t - Test context
 * @returns {Promise<string>} Directory holding the recordings
 */
async function installRecordingClaude(t) {
  const binDir = await mkdtemp(join(tmpdir(), 'agent-commander-lib-'));
  const fakeClaude = join(binDir, 'claude');
  await writeFile(
    fakeClaude,
    `#!/bin/bash
out=${JSON.stringify(binDir)}
tr '\\0' ' ' < /proc/$PPID/cmdline > "$out/shell-cmdline"
printf '%s\\n' "$@" > "$out/argv"
env > "$out/env"
while [ $# -gt 0 ]; do
  case "$1" in
    --system-prompt-file) cat "$2" > "$out/system-prompt"; shift ;;
    --append-system-prompt-file) cat "$2" > "$out/append-system-prompt"; shift ;;
    --json-schema) printf '%s' "$2" > "$out/schema"; shift ;;
  esac
  shift
done
printf '%s\\n' '{"type":"result","subtype":"success","session_id":"s","result":"ok"}'
`
  );
  await chmod(fakeClaude, 0o755);
  const previousPath = process.env.PATH || '';
  process.env.PATH = `${binDir}:${previousPath}`;
  t.after(async () => {
    process.env.PATH = previousPath;
    await rm(binDir, { recursive: true, force: true });
  });
  return binDir;
}

test(
  'agent - secrets and prompts stay off the command line',
  { skip: !onLinux },
  async (t) => {
    const out = await installRecordingClaude(t);
    const schema = { type: 'object', properties: { secretField: {} } };
    const controller = agent({
      tool: 'claude',
      workingDirectory: '/tmp',
      prompt: 'user prompt',
      systemPrompt: 'PRIVATE-SYSTEM-PROMPT',
      jsonSchema: schema,
      json: true,
      toolOptions: {
        appendSystemPrompt: 'PRIVATE-APPEND',
        extraEnv: { API_TOKEN: 'sk-very-secret', HOME: null },
      },
    });
    await controller.start({ attached: false });
    await controller.stop();

    const shellCmdline = await readFile(join(out, 'shell-cmdline'), 'utf8');
    const argv = await readFile(join(out, 'argv'), 'utf8');
    const env = await readFile(join(out, 'env'), 'utf8');
    for (const secret of [
      'sk-very-secret',
      'PRIVATE-SYSTEM-PROMPT',
      'PRIVATE-APPEND',
      'secretField',
    ]) {
      assert.ok(!shellCmdline.includes(secret), `${secret} in ${shellCmdline}`);
    }
    assert.ok(!argv.includes('PRIVATE'), argv);
    assert.ok(argv.includes('--system-prompt-file'));
    assert.ok(argv.includes('--append-system-prompt-file'));
    assert.strictEqual(
      await readFile(join(out, 'system-prompt'), 'utf8'),
      'PRIVATE-SYSTEM-PROMPT'
    );
    assert.strictEqual(
      await readFile(join(out, 'append-system-prompt'), 'utf8'),
      'PRIVATE-APPEND'
    );
    assert.deepStrictEqual(
      JSON.parse(await readFile(join(out, 'schema'), 'utf8')),
      schema
    );
    assert.match(env, /^API_TOKEN=sk-very-secret$/m);
    assert.doesNotMatch(env, /^HOME=/m);
  }
);

test(
  'agent - inheritEnv allowlist restricts the child environment',
  { skip: !onLinux },
  async (t) => {
    const out = await installRecordingClaude(t);
    process.env.AGENT_COMMANDER_TEST_DB_PASSWORD = 'db-secret';
    t.after(() => {
      delete process.env.AGENT_COMMANDER_TEST_DB_PASSWORD;
    });
    const controller = agent({
      tool: 'claude',
      workingDirectory: '/tmp',
      prompt: 'hi',
      json: true,
      toolOptions: { inheritEnv: ['PATH'], extraEnv: { ONLY_ME: '1' } },
    });
    await controller.start({ attached: false });
    await controller.stop();
    const env = await readFile(join(out, 'env'), 'utf8');
    assert.doesNotMatch(env, /AGENT_COMMANDER_TEST_DB_PASSWORD/);
    assert.match(env, /^ONLY_ME=1$/m);
    assert.match(env, /^PATH=/m);
  }
);

test(
  'agent - handleSignals: false installs no process signal listeners',
  { skip: process.platform === 'win32' || isDeno },
  async (t) => {
    await installRecordingClaude(t);
    const before = {
      SIGINT: process.listenerCount('SIGINT'),
      SIGTERM: process.listenerCount('SIGTERM'),
    };
    for (const [agentOptions, startOptions, expectedExtra] of [
      [{ handleSignals: false }, {}, 0],
      [{}, { signalHandlers: false }, 0],
      [{}, {}, 1],
    ]) {
      const controller = agent({
        tool: 'claude',
        workingDirectory: '/tmp',
        prompt: 'hi',
        json: true,
        ...agentOptions,
      });
      await controller.start({ attached: false, ...startOptions });
      assert.strictEqual(
        process.listenerCount('SIGTERM'),
        before.SIGTERM + expectedExtra
      );
      assert.strictEqual(
        process.listenerCount('SIGINT'),
        before.SIGINT + expectedExtra
      );
      await controller.stop();
      assert.strictEqual(process.listenerCount('SIGTERM'), before.SIGTERM);
    }
  }
);
