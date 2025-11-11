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

  assert.strictEqual(result.exitCode, 0);
  assert.ok(result.command);
  assert.ok(result.command.includes('echo'));
});

test('agent - stop throws for no isolation', async () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'none',
  });

  await assert.rejects(
    async () => {
      await controller.stop();
    },
    /Cannot stop agent with no isolation/
  );
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
  assert.ok(result.command);
  assert.ok(result.command.includes('screen'));
  assert.ok(result.command.includes('test-session'));
});
