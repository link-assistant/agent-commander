/**
 * Tests for per-run tool overrides (issue #57): a caller replaces a failing or
 * missing part of a tool, or drives a tool that is not registered, without
 * waiting for an agent-commander release.
 */

import { mock, test } from 'node:test';
import assert from 'node:assert';
import {
  agent,
  buildAgentCommand,
  escapeArg,
  resolveToolConfig,
  tools,
} from '../src/index.mjs';

const dryRunCommand = async (options) => {
  const controller = agent(options);
  const log = mock.method(console, 'log', () => {});
  try {
    await controller.start({ dryRun: true });
  } finally {
    log.mock.restore();
  }
  return log.mock.calls.at(-1).arguments[0];
};

test('resolveToolConfig layers overrides over the registered tool', () => {
  assert.strictEqual(
    resolveToolConfig({ toolName: 'claude' }),
    tools.claude,
    'no overrides keep the registered config'
  );
  assert.strictEqual(resolveToolConfig({ toolName: 'my-agent' }), undefined);
  const parseOutput = () => [];
  const claude = resolveToolConfig({
    toolName: 'claude',
    toolOverrides: { parseOutput, supportsAttachments: true },
  });
  assert.strictEqual(claude.parseOutput, parseOutput);
  assert.strictEqual(claude.supportsAttachments, true);
  assert.strictEqual(claude.buildCommand, tools.claude.buildCommand);
  assert.strictEqual(tools.claude.supportsAttachments, false, 'registry kept');
  assert.strictEqual(
    resolveToolConfig({ toolName: 'my-agent', toolOverrides: {} }).name,
    'my-agent'
  );
  assert.throws(
    () => resolveToolConfig({ toolName: 'claude', toolOverrides: ['x'] }),
    /toolOverrides must be an object/
  );
});

test('an override builder can add a flag the built-in lacks', async () => {
  const command = await dryRunCommand({
    tool: 'claude',
    workingDirectory: '/tmp',
    prompt: 'hi',
    attachments: ['shot.png', 'my shot.png'],
    toolOverrides: {
      supportsAttachments: true,
      buildCommand: ({ attachments, ...rest }) =>
        `${tools.claude.buildCommand(rest)} --image ${attachments.map(escapeArg).join(' ')}`,
    },
  });
  // The image list is escaped, then the whole command for `bash -c "..."`.
  assert.match(command, /claude .*--image shot\.png \\"my shot\.png\\"/);
  // Without the override the built-in still refuses the option.
  assert.throws(
    () =>
      buildAgentCommand({
        tool: 'claude',
        workingDirectory: '/tmp',
        attachments: ['shot.png'],
      }),
    /does not support file attachments/
  );
});

test('an unregistered tool runs through override builder, parser and extractors', async () => {
  const lines = [
    { type: 'init', session: 'sess-1' },
    { type: 'done', tokens: 42 },
  ]
    .map((event) => `'${JSON.stringify(event)}'`)
    .join(' ');
  const controller = agent({
    tool: 'my-agent',
    workingDirectory: '/tmp',
    prompt: 'hi',
    toolOverrides: {
      buildCommand: ({ model }) => {
        assert.strictEqual(model, 'm1', 'typed options reach the builder');
        return `printf '%s\\n' ${lines}`;
      },
      parseOutput: ({ output }) =>
        output
          .trim()
          .split('\n')
          .map((line) => ({ ...JSON.parse(line), custom: true })),
      extractSessionId: ({ output }) =>
        JSON.parse(output.split('\n')[0]).session,
      extractUsage: ({ output }) => ({
        totalTokens: JSON.parse(output.trim().split('\n').at(-1)).tokens,
      }),
    },
    model: 'm1',
  });
  await controller.start({ attached: false });
  const result = await controller.stop();
  assert.strictEqual(result.exitCode, 0);
  assert.strictEqual(result.sessionId, 'sess-1');
  assert.deepStrictEqual(result.usage, { totalTokens: 42 });
  assert.deepStrictEqual(
    result.output.parsed.map((event) => [event.type, event.custom]),
    [
      ['init', true],
      ['done', true],
    ]
  );
  assert.strictEqual(result.metadata.sessionId, 'sess-1');
});

test('an override parser replaces the built-in parser of a registered tool', async () => {
  const controller = agent({
    tool: 'codex',
    workingDirectory: '/tmp',
    prompt: 'hi',
    json: true,
    toolOverrides: {
      buildCommand: () => `printf '%s\\n' 'plain text'`,
      parseOutput: ({ output }) => [{ type: 'text', text: output.trim() }],
      extractSessionId: () => 'thread-1',
    },
  });
  await controller.start({ attached: false });
  const result = await controller.stop();
  assert.deepStrictEqual(result.output.parsed, [
    { type: 'text', text: 'plain text' },
  ]);
  assert.strictEqual(result.sessionId, 'thread-1');
});
