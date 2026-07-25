import assert from 'node:assert';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  buildAgentTuiLaunch,
  captureAgentTui,
  normalizeTuiTranscript,
} from '../src/index.mjs';

const directory = dirname(fileURLToPath(import.meta.url));
const tools = ['claude', 'codex', 'opencode', 'agent', 'gemini', 'qwen'];
const isDeno = typeof globalThis.Deno !== 'undefined';

test('buildAgentTuiLaunch selects interactive mode for every supported tool', () => {
  for (const tool of tools) {
    const launch = buildAgentTuiLaunch({
      tool,
      workingDirectory: '/workspace',
      executable: `${tool}-test`,
      model: 'test-model',
    });

    assert.strictEqual(launch.file, `${tool}-test`);
    assert.strictEqual(launch.cwd, '/workspace');
    assert.strictEqual(launch.env.TERM, 'xterm-256color');
    assert.ok(!launch.args.includes('exec'), tool);
    assert.ok(!launch.args.includes('run'), tool);
    assert.ok(!launch.args.includes('--json'), tool);
    assert.ok(!launch.args.includes('stream-json'), tool);
  }

  const explicitTerm = buildAgentTuiLaunch({
    tool: 'codex',
    workingDirectory: '/workspace',
    executable: 'codex-test',
    extraEnv: { TERM: 'screen-256color' },
  });
  assert.strictEqual(explicitTerm.env.TERM, 'screen-256color');
});

test('buildAgentTuiLaunch maps interactive safety and resume options', () => {
  const launch = (tool, options = {}) =>
    buildAgentTuiLaunch({
      tool,
      workingDirectory: '/workspace',
      executable: `${tool}-test`,
      resume: 'session-1',
      ...options,
    }).args;

  assert.deepStrictEqual(launch('claude', { readOnly: true }), [
    '--permission-mode',
    'plan',
    '--resume',
    'session-1',
    '--ax-screen-reader',
  ]);
  assert.deepStrictEqual(launch('codex', { readOnly: true }), [
    '--sandbox',
    'read-only',
    '--ask-for-approval',
    'never',
    '--no-alt-screen',
    'resume',
    'session-1',
  ]);
  assert.deepStrictEqual(launch('opencode', { approveEach: true }), [
    '--mini',
    '--no-replay',
    '--session',
    'session-1',
  ]);
  assert.deepStrictEqual(launch('agent', { approveEach: true }), [
    '--permission-mode',
    'ask',
    '--resume',
    'session-1',
  ]);
  assert.deepStrictEqual(launch('gemini', { approveEach: true }), [
    '--approval-mode',
    'default',
    '--resume',
    'session-1',
  ]);
  assert.deepStrictEqual(launch('qwen', { readOnly: true }), [
    '--read-only',
    '--resume',
    'session-1',
  ]);
});

test(
  'captureAgentTui drives and normalizes all agent clients',
  {
    skip: isDeno,
    // Six native PTY launches are intentionally exercised in series. Windows
    // startup can exceed Bun's five-second default even when every capture
    // finishes normally.
    timeout: 30_000,
  },
  async (t) => {
    const artifactRoot = await mkdtemp(join(tmpdir(), 'agent-tui-'));
    t.after(() => rm(artifactRoot, { recursive: true, force: true }));

    for (const tool of tools) {
      const artifactDirectory = join(artifactRoot, tool);
      const capture = await captureAgentTui({
        tool,
        workingDirectory: process.cwd(),
        executable: process.execPath,
        prefixArgs: [join(directory, 'fixtures/fake-agent-tui.mjs'), tool],
        prompt: 'hello',
        promptAfter: `ready:${tool}`,
        startupInteractions: [
          {
            after: `trust:${tool}`,
            text: 'y',
            key: 'ENTER',
          },
        ],
        cols: 24,
        rows: 6,
        interactions: [
          {
            after: 'waiting-resize',
            resize: { cols: 40, rows: 10 },
          },
        ],
        artifactDirectory,
      });

      assert.strictEqual(capture.exitCode, 0, tool);
      assert.strictEqual(capture.interactionCount, 3, tool);
      assert.ok(
        capture.transcript.replace(/\s/gu, '').includes('accepted=y'),
        tool
      );
      assert.deepStrictEqual(
        capture.events.map(({ type }) => type),
        ['message', 'tool_call', 'message'],
        tool
      );
      assert.strictEqual(capture.events[0].role, 'user', tool);
      assert.strictEqual(capture.events[2].content, `${tool} completed`, tool);
      assert.match(capture.transcript, /resized:40x10/, tool);
      assert.ok(
        (await readFile(join(artifactDirectory, 'recording.svg'))).length > 0,
        tool
      );
    }
  }
);

test('normalizeTuiTranscript keeps repeated semantic events in order', () => {
  assert.deepStrictEqual(
    normalizeTuiTranscript(
      [
        'user:same',
        'assistant:first',
        'user:same',
        'tool_call:read README.md',
      ].join('\n')
    ),
    [
      { type: 'message', role: 'user', content: 'same' },
      { type: 'message', role: 'assistant', content: 'first' },
      { type: 'message', role: 'user', content: 'same' },
      { type: 'tool_call', name: 'read', input: 'README.md' },
    ]
  );
});
