/**
 * Tests for cli-parser module
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseArgs,
  parseStartAgentArgs,
  parseStopAgentArgs,
  validateStartAgentOptions,
  validateStopAgentOptions,
} from '../src/cli-parser.mjs';

test('parseArgs - basic flags', () => {
  const args = ['--foo', 'bar', '--baz'];
  const result = parseArgs(args);

  assert.strictEqual(result.foo, 'bar');
  assert.strictEqual(result.baz, true);
});

test('parseArgs - with positional', () => {
  const args = ['--foo', 'bar', 'positional1'];
  const result = parseArgs(args);

  assert.strictEqual(result.foo, 'bar');
  assert.deepStrictEqual(result._positional, ['positional1']);
});

test('parseStartAgentArgs - basic', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--prompt',
    'Hello',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.tool, 'claude');
  assert.strictEqual(result.workingDirectory, '/tmp/test');
  assert.strictEqual(result.prompt, 'Hello');
  assert.strictEqual(result.isolation, 'none');
});

test('parseStartAgentArgs - with isolation', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--isolation',
    'screen',
    '--screen-name',
    'my-session',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.isolation, 'screen');
  assert.strictEqual(result.screenName, 'my-session');
});

test('parseStartAgentArgs - dry-run flag', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--dry-run',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.dryRun, true);
});

test('parseStopAgentArgs - screen', () => {
  const args = ['--isolation', 'screen', '--screen-name', 'my-session'];
  const result = parseStopAgentArgs(args);

  assert.strictEqual(result.isolation, 'screen');
  assert.strictEqual(result.screenName, 'my-session');
});

test('validateStartAgentOptions - valid', () => {
  const options = {
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'none',
  };
  const result = validateStartAgentOptions(options);

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateStartAgentOptions - missing tool', () => {
  const options = {
    workingDirectory: '/tmp/test',
  };
  const result = validateStartAgentOptions(options);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('tool')));
});

test('validateStartAgentOptions - screen without name', () => {
  const options = {
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'screen',
  };
  const result = validateStartAgentOptions(options);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('screen-name')));
});

test('validateStopAgentOptions - valid', () => {
  const options = {
    isolation: 'screen',
    screenName: 'my-session',
  };
  const result = validateStopAgentOptions(options);

  assert.strictEqual(result.valid, true);
  assert.strictEqual(result.errors.length, 0);
});

test('validateStopAgentOptions - missing isolation', () => {
  const options = {};
  const result = validateStopAgentOptions(options);

  assert.strictEqual(result.valid, false);
  assert.ok(result.errors.some((e) => e.includes('isolation')));
});

// New Claude CLI options tests (issue #3)
test('parseStartAgentArgs - with model and fallback-model', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--model',
    'opus',
    '--fallback-model',
    'sonnet',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.model, 'opus');
  assert.strictEqual(result.fallbackModel, 'sonnet');
});

test('parseStartAgentArgs - with session management options', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--resume',
    'abc123',
    '--session-id',
    '123e4567-e89b-12d3-a456-426614174000',
    '--fork-session',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.resume, 'abc123');
  assert.strictEqual(result.sessionId, '123e4567-e89b-12d3-a456-426614174000');
  assert.strictEqual(result.forkSession, true);
});

test('parseStartAgentArgs - with append-system-prompt', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--system-prompt',
    'You are a helpful assistant',
    '--append-system-prompt',
    'Extra instructions here',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.systemPrompt, 'You are a helpful assistant');
  assert.strictEqual(result.appendSystemPrompt, 'Extra instructions here');
});

test('parseStartAgentArgs - with prompt-file', () => {
  const args = [
    '--tool',
    'codex',
    '--working-directory',
    '/tmp/test',
    '--prompt-file',
    '/tmp/prompt.txt',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.promptFile, '/tmp/prompt.txt');
});

test('parseStartAgentArgs - with verbose and replay-user-messages', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--verbose',
    '--replay-user-messages',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.verbose, true);
  assert.strictEqual(result.replayUserMessages, true);
});

test('parseStartAgentArgs - with read-only flag', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--read-only',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.readOnly, true);
});

test('parseStartAgentArgs - with repeated raw passthrough options', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--tool-executable',
    '/opt/claude',
    '--tool-env',
    'MCP_TIMEOUT=10000',
    '--tool-env',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
    '--tool-arg',
    '--mcp-config',
    '--tool-arg',
    '/tmp/mcp.json',
    '--skip-default-safety-flags',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.toolExecutable, '/opt/claude');
  assert.deepStrictEqual(result.toolEnv, [
    'MCP_TIMEOUT=10000',
    'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1',
  ]);
  assert.deepStrictEqual(result.toolArgs, ['--mcp-config', '/tmp/mcp.json']);
  assert.strictEqual(result.skipDefaultSafetyFlags, true);
});

test('parseStartAgentArgs - plan-only aliases read-only', () => {
  const args = [
    '--tool',
    'claude',
    '--working-directory',
    '/tmp/test',
    '--plan-only',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.readOnly, true);
});

test('parseStartAgentArgs - with approve-each flag', () => {
  const args = [
    '--tool',
    'agent',
    '--working-directory',
    '/tmp/test',
    '--approve-each',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.approveEach, true);
});

test('parseStartAgentArgs - permission-mode ask aliases approve-each', () => {
  const args = [
    '--tool',
    'agent',
    '--working-directory',
    '/tmp/test',
    '--permission-mode',
    'ask',
  ];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.approveEach, true);
});

test('parseStartAgentArgs - approve-each defaults to false', () => {
  const args = ['--tool', 'agent', '--working-directory', '/tmp/test'];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.approveEach, false);
});

test('parseStartAgentArgs - defaults for new options', () => {
  const args = ['--tool', 'claude', '--working-directory', '/tmp/test'];
  const result = parseStartAgentArgs(args);

  assert.strictEqual(result.verbose, false);
  assert.strictEqual(result.replayUserMessages, false);
  assert.strictEqual(result.readOnly, false);
  assert.strictEqual(result.forkSession, false);
  assert.strictEqual(result.model, undefined);
  assert.strictEqual(result.fallbackModel, undefined);
  assert.strictEqual(result.resume, undefined);
  assert.strictEqual(result.sessionId, undefined);
  assert.strictEqual(result.appendSystemPrompt, undefined);
  assert.strictEqual(result.promptFile, undefined);
});
