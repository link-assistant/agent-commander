import assert from 'node:assert';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
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

  const unset = buildAgentTuiLaunch({
    tool: 'codex',
    workingDirectory: '/workspace',
    executable: 'codex-test',
    extraEnv: { HOME: null },
  });
  assert.ok(!('HOME' in unset.env));
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

// One test per agent client: each native PTY launch gets its own budget, so
// an occasional slow Windows ConPTY start fails (or passes) one client
// instead of the six captures sharing a single 30 s budget.
for (const tool of tools) {
  test(
    `captureAgentTui drives and normalizes the ${tool} client`,
    {
      skip: isDeno,
      // Windows startup can exceed Bun's five-second default even when the
      // capture finishes normally.
      timeout: 30_000,
    },
    async (t) => {
      const artifactDirectory = await mkdtemp(
        join(tmpdir(), `agent-tui-${tool}-`)
      );
      t.after(() => rm(artifactDirectory, { recursive: true, force: true }));

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
      assert.ok(
        (await readFile(join(artifactDirectory, 'recording.gif'))).length > 0,
        tool
      );
      assert.strictEqual(capture.asciicast.header.width, 24, tool);
      assert.strictEqual(capture.asciicast.header.height, 6, tool);
    }
  );
}

for (const tool of tools) {
  test(
    `captureAgentTui defaults ${tool} to publishable 4:3 geometry`,
    { skip: isDeno, timeout: 30_000 },
    async () => {
      const capture = await captureAgentTui({
        tool,
        workingDirectory: process.cwd(),
        executable: process.execPath,
        prefixArgs: [join(directory, 'fixtures/fake-agent-tui.mjs'), tool],
        prompt: 'hello',
        promptAfter: `ready:${tool}`,
        startupInteractions: [
          { after: `trust:${tool}`, text: 'y', key: 'ENTER' },
        ],
        interactions: [
          {
            after: 'waiting-resize',
            resize: { cols: 81, rows: 31 },
          },
        ],
      });

      assert.strictEqual(capture.asciicast.header.width, 80, tool);
      assert.strictEqual(capture.asciicast.header.height, 30, tool);
    }
  );
}

test(
  'captureAgentTui forwards renderer options and selects artifacts',
  // Like the other capture tests, this launches a PTY and renders a GIF.
  // Keep the runner budget consistent with those native integration tests.
  { skip: isDeno, timeout: 30_000 },
  async (t) => {
    const directory = dirname(fileURLToPath(import.meta.url));
    const artifactDirectory = await mkdtemp(
      join(tmpdir(), 'agent-tui-options-')
    );
    t.after(() => rm(artifactDirectory, { recursive: true, force: true }));

    await captureAgentTui({
      tool: 'opencode',
      workingDirectory: process.cwd(),
      executable: process.execPath,
      prefixArgs: [join(directory, 'fixtures/fake-agent-tui.mjs'), 'opencode'],
      prompt: 'hello',
      promptAfter: 'ready:opencode',
      startupInteractions: [
        { after: 'trust:opencode', text: 'y', key: 'ENTER' },
      ],
      interactions: [
        {
          after: 'waiting-resize',
          resize: { cols: 81, rows: 31 },
        },
      ],
      aspectRatio: 16 / 9,
      artifactDirectory,
      artifactOptions: {
        borderRadius: 0,
        cellWidth: 10,
        cellHeight: 20,
        fontSize: 16,
        padding: 8,
        background: '#010203',
        foreground: '#fefdfc',
      },
      artifacts: ['svg', 'gif'],
    });

    const recording = await readFile(
      join(artifactDirectory, 'recording.svg'),
      'utf8'
    );
    assert.match(recording, /rx="0"/u);
    assert.match(recording, /fill="#010203"/u);
    assert.match(recording, /font-size="16"/u);
    await access(join(artifactDirectory, 'recording.gif'));
    await assert.rejects(access(join(artifactDirectory, 'session.cast')));
    await assert.rejects(access(join(artifactDirectory, 'frames.json')));
    await assert.rejects(access(join(artifactDirectory, 'transcript.txt')));
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

test(
  'captureAgentTui forwards frameMode and recording to command-stream',
  { skip: isDeno || process.platform === 'win32', timeout: 30_000 },
  async () => {
    const script =
      "for screen in one two three; do printf '\\033[2J\\033[H%s\\n' $screen; sleep 0.05; done";
    const capture = (options) =>
      captureAgentTui({
        tool: 'claude',
        workingDirectory: process.cwd(),
        executable: '/bin/sh',
        prefixArgs: ['-c', script, 'claude'],
        cols: 20,
        rows: 4,
        settleMilliseconds: 10,
        timeoutMilliseconds: 5000,
        ...options,
      });

    const full = await capture({ frameMode: 'writes' });
    assert.ok(full.frames.length >= 3, `${full.frames.length} frames`);
    assert.ok(full.asciicast.events.length > 0);

    // Without recording only the latest frame and no cast events remain.
    const latest = await capture({ frameMode: 'writes', recording: false });
    assert.strictEqual(latest.frames.length, 1);
    assert.strictEqual(latest.asciicast.events.length, 0);
    assert.match(latest.transcript, /three/u);
  }
);
