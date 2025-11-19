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
  const args = ['--tool', 'claude', '--working-directory', '/tmp/test', '--dry-run'];
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
