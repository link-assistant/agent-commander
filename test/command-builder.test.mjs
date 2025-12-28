/**
 * Tests for command-builder module
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildAgentCommand,
  buildScreenStopCommand,
  buildDockerStopCommand,
  buildPipedCommand,
} from '../src/command-builder.mjs';

test('buildAgentCommand - basic no isolation with known tool (claude)', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    isolation: 'none',
  });

  assert.ok(command.includes('bash -c'));
  assert.ok(command.includes('cd'));
  assert.ok(command.includes('/tmp/test'));
  assert.ok(command.includes('claude'));
  // Claude tool builds its own args format with --prompt
  assert.ok(command.includes('--prompt'));
  assert.ok(command.includes('Hello'));
});

test('buildAgentCommand - with system prompt (claude)', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    systemPrompt: 'You are helpful',
    isolation: 'none',
  });

  assert.ok(command.includes('--prompt'));
  assert.ok(command.includes('--system-prompt'));
  assert.ok(command.includes('You are helpful'));
});

test('buildAgentCommand - unknown tool uses generic format', () => {
  const command = buildAgentCommand({
    tool: 'unknown-tool',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    isolation: 'none',
  });

  assert.ok(command.includes('bash -c'));
  assert.ok(command.includes('unknown-tool'));
  // Generic tool uses --prompt format
  assert.ok(command.includes('--prompt'));
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

test('buildAgentCommand - with model (claude)', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    model: 'opus',
    isolation: 'none',
  });

  assert.ok(command.includes('--model'));
  // Opus model should be mapped to full ID
  assert.ok(command.includes('claude-opus-4-5-20251101'));
});

test('buildAgentCommand - with codex tool', () => {
  const command = buildAgentCommand({
    tool: 'codex',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    isolation: 'none',
  });

  assert.ok(command.includes('codex'));
  assert.ok(command.includes('exec'));
  assert.ok(command.includes('--json'));
});

test('buildAgentCommand - with agent tool', () => {
  const command = buildAgentCommand({
    tool: 'agent',
    workingDirectory: '/tmp/test',
    model: 'grok',
    isolation: 'none',
  });

  assert.ok(command.includes('agent'));
  assert.ok(command.includes('--model'));
  assert.ok(command.includes('opencode/grok-code'));
});

test('buildAgentCommand - with opencode tool', () => {
  const command = buildAgentCommand({
    tool: 'opencode',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    isolation: 'none',
  });

  assert.ok(command.includes('opencode'));
  assert.ok(command.includes('run'));
  assert.ok(command.includes('--format'));
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

test('buildPipedCommand - basic', () => {
  const command = buildPipedCommand({
    input: 'Hello World',
    command: 'mycommand --flag',
  });

  assert.ok(command.includes("printf '%s'"));
  assert.ok(command.includes('Hello World'));
  assert.ok(command.includes('mycommand --flag'));
});

test('buildPipedCommand - escapes single quotes', () => {
  const command = buildPipedCommand({
    input: "It's working",
    command: 'mycommand',
  });

  assert.ok(command.includes("'\\''"));
});
