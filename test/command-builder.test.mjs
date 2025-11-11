/**
 * Tests for command-builder module
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildAgentCommand,
  buildScreenStopCommand,
  buildDockerStopCommand,
} from '../src/command-builder.mjs';

test('buildAgentCommand - basic no isolation', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    isolation: 'none',
  });

  assert.ok(command.includes('cd "/tmp/test"'));
  assert.ok(command.includes('claude'));
  assert.ok(command.includes('--prompt "Hello"'));
});

test('buildAgentCommand - with system prompt', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    systemPrompt: 'You are helpful',
    isolation: 'none',
  });

  assert.ok(command.includes('--prompt "Hello"'));
  assert.ok(command.includes('--system-prompt "You are helpful"'));
});

test('buildAgentCommand - screen isolation', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'screen',
    screenName: 'my-session',
    detached: true,
  });

  assert.ok(command.includes('screen'));
  assert.ok(command.includes('-dmS'));
  assert.ok(command.includes('my-session'));
});

test('buildAgentCommand - docker isolation', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    isolation: 'docker',
    containerName: 'my-container',
    detached: true,
  });

  assert.ok(command.includes('docker run'));
  assert.ok(command.includes('-d'));
  assert.ok(command.includes('--name "my-container"'));
  assert.ok(command.includes('-v "/tmp/test:/tmp/test"'));
});

test('buildScreenStopCommand', () => {
  const command = buildScreenStopCommand('my-session');
  assert.ok(command.includes('screen'));
  assert.ok(command.includes('-S "my-session"'));
  assert.ok(command.includes('-X quit'));
});

test('buildDockerStopCommand', () => {
  const command = buildDockerStopCommand('my-container');
  assert.ok(command.includes('docker stop "my-container"'));
  assert.ok(command.includes('docker rm "my-container"'));
});
