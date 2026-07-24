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
    assert.ok(!launch.args.includes('exec'), tool);
    assert.ok(!launch.args.includes('run'), tool);
    assert.ok(!launch.args.includes('--json'), tool);
    assert.ok(!launch.args.includes('stream-json'), tool);
  }
});

test(
  'captureAgentTui drives and normalizes all agent clients',
  { skip: isDeno },
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
