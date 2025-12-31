/**
 * Tests for main library interface
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { agent } from '../src/index.mjs';

test('agent - throws without tool', () => {
  assert.throws(() => {
    agent({
      workingDirectory: '/tmp/test',
    });
  }, /tool is required/);
});

test('agent - throws without workingDirectory', () => {
  assert.throws(() => {
    agent({
      tool: 'claude',
    });
  }, /workingDirectory is required/);
});

test('agent - throws for screen isolation without screenName', () => {
  assert.throws(() => {
    agent({
      tool: 'claude',
      workingDirectory: '/tmp/test',
      isolation: 'screen',
    });
  }, /screenName is required/);
});

test('agent - throws for docker isolation without containerName', () => {
  assert.throws(() => {
    agent({
      tool: 'claude',
      workingDirectory: '/tmp/test',
      isolation: 'docker',
    });
  }, /containerName is required/);
});

test('agent - creates controller with valid options', () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
  });

  assert.ok(controller);
  assert.strictEqual(typeof controller.start, 'function');
  assert.strictEqual(typeof controller.stop, 'function');
});

test('agent - start in dry-run mode', async () => {
  const controller = agent({
    tool: 'echo',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
  });

  const result = await controller.start({ dryRun: true });

  // start() in dry-run mode returns void, doesn't return result
  assert.strictEqual(result, undefined);
});

test('agent - stop throws for no isolation without start', async () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'none',
  });

  await assert.rejects(async () => {
    await controller.stop();
  }, /Agent not started/);
});

test('agent - stop in dry-run mode with screen', async () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'screen',
    screenName: 'test-session',
  });

  const result = await controller.stop({ dryRun: true });

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.output);
  assert.ok(result.output.plain !== undefined);
  assert.ok(result.output.parsed !== undefined);
});

test('agent - start and stop with no isolation', async () => {
  const controller = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Hello World',
  });

  // Start should not wait for completion
  await controller.start({ attached: false });

  // Stop should wait and collect output
  const result = await controller.stop();

  assert.ok(result.exitCode !== null);
  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.output);
  assert.ok(result.output.plain);
  assert.ok(result.output.plain.includes('Hello World'));
});
