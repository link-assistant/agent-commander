/**
 * Tests for live input into a running agent (issue #57).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  buildInterruptFrame,
  buildAgentCommand,
  buildUserInputFrame,
  supportsLiveInput,
  getTool,
} from '../src/index.mjs';

const isDeno = typeof globalThis.Deno !== 'undefined';

// Echoes every stdin frame, answers each user frame with a result and
// reports end of input, like `claude -p --input-format stream-json`.
const FAKE_CLAUDE = `#!/usr/bin/env bash
printf '%s\\n' '{"type":"system","subtype":"init","session_id":"live-1"}'
turn=0
while IFS= read -r line; do
  printf '{"type":"echo","frame":%s}\\n' "$line"
  case "$line" in *control_request*) continue ;; esac
  turn=$((turn + 1))
  printf '{"type":"result","subtype":"success","is_error":false,"result":"turn %s","session_id":"live-1"}\\n' "$turn"
done
printf '%s\\n' '{"type":"echo","eof":true}'
`;

test('live input frames match each tool stdin protocol', () => {
  assert.deepStrictEqual(
    buildUserInputFrame({ tool: 'claude', content: 'hi' }),
    {
      type: 'user',
      message: { role: 'user', content: 'hi' },
    }
  );
  const blocks = [
    { type: 'text', text: 'What is this?' },
    {
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: 'iVBORw0=' },
    },
  ];
  assert.deepStrictEqual(
    buildUserInputFrame({ tool: 'claude', content: blocks }).message.content,
    blocks
  );
  assert.deepStrictEqual(
    buildUserInputFrame({
      tool: 'agent',
      content: 'go',
      systemPrompt: 'Be brief',
    }),
    { type: 'user', message: 'Be brief\n\ngo' }
  );
  assert.throws(
    () => buildUserInputFrame({ tool: 'agent', content: blocks }),
    /accepts only text/
  );
  assert.deepStrictEqual(
    buildInterruptFrame({ tool: 'claude', requestId: 'r1' }),
    {
      type: 'control_request',
      request_id: 'r1',
      request: { subtype: 'interrupt' },
    }
  );
  assert.deepStrictEqual(
    buildUserInputFrame({
      tool: 'qwen',
      content: 'go',
      systemPrompt: 'Be brief',
    }),
    { type: 'user', message: { role: 'user', content: 'Be brief\n\ngo' } }
  );
  assert.strictEqual(
    buildInterruptFrame({ tool: 'qwen', requestId: 'q1' }).request.subtype,
    'interrupt'
  );
  assert.throws(
    () => buildInterruptFrame({ tool: 'agent' }),
    /no interrupt control request/
  );
  assert.deepStrictEqual(
    ['claude', 'agent', 'codex', 'opencode', 'gemini', 'qwen'].filter((tool) =>
      supportsLiveInput(getTool({ toolName: tool }))
    ),
    ['claude', 'agent', 'qwen']
  );
});

test('liveInput commands read frames from stdin instead of a prompt argument', () => {
  const qwen = buildAgentCommand({
    tool: 'qwen',
    workingDirectory: '/tmp',
    prompt: 'hi',
    json: true,
    jsonInput: true,
    streamInput: true,
  });
  assert.match(
    qwen,
    /--input-format "?stream-json"? --output-format|--output-format "?stream-json"? --input-format/
  );
  assert.doesNotMatch(qwen, / -p /);
  const agentCommand = buildAgentCommand({
    tool: 'agent',
    workingDirectory: '/tmp',
    prompt: 'hi',
    json: true,
    jsonInput: true,
    streamInput: true,
  });
  assert.match(agentCommand, /--input-format "?stream-json"?/);
  assert.doesNotMatch(agentCommand, /printf/);
});

test('liveInput is rejected for tools and modes without a stdin channel', async () => {
  await assert.rejects(
    agent({
      tool: 'codex',
      workingDirectory: '/tmp',
      prompt: 'hi',
      liveInput: true,
    }).start({ attached: false }),
    /does not read live input/
  );
  await assert.rejects(
    agent({
      tool: 'claude',
      workingDirectory: '/tmp',
      prompt: 'hi',
      liveInput: true,
      isolation: 'screen',
      screenName: 'live',
    }).start({ attached: false }),
    /attached run without isolation/
  );
  const notLive = agent({ tool: 'claude', workingDirectory: '/tmp' });
  assert.throws(() => notLive.sendMessage('hi'), /not started with liveInput/);
});

test(
  'liveInput queues follow-up messages and interrupts into one session',
  { skip: process.platform === 'win32' || isDeno },
  async (t) => {
    const binDir = await mkdtemp(join(tmpdir(), 'agent-commander-live-'));
    await writeFile(join(binDir, 'claude'), FAKE_CLAUDE);
    await chmod(join(binDir, 'claude'), 0o755);
    const previousPath = process.env.PATH || '';
    process.env.PATH = `${binDir}:${previousPath}`;
    t.after(async () => {
      process.env.PATH = previousPath;
      await rm(binDir, { recursive: true, force: true });
    });

    const controller = agent({
      tool: 'claude',
      workingDirectory: '/tmp',
      prompt: 'first',
      liveInput: true,
    });
    await controller.start({ attached: false });
    assert.strictEqual(controller.sendMessage('second'), true);
    assert.strictEqual(controller.interrupt(), true);
    const result = await controller.stop();

    assert.strictEqual(result.exitCode, 0);
    const frames = result.output.parsed
      .filter((message) => message.type === 'echo')
      .map((message) => message.frame ?? 'eof');
    assert.deepStrictEqual(
      frames.map((frame) =>
        frame === 'eof'
          ? frame
          : frame.type === 'user'
            ? frame.message.content
            : frame.request.subtype
      ),
      ['first', 'second', 'interrupt', 'eof']
    );
    assert.strictEqual(result.sessionId, 'live-1');
    assert.throws(() => controller.sendMessage('late'), /input is closed/);
  }
);
