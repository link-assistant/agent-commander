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
  assert.ok(command.includes('claude-opus-4-7'));
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

test('buildAgentCommand - codex can read prompt from file', () => {
  const inlinePrompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
  const command = buildAgentCommand({
    tool: 'codex',
    workingDirectory: '/tmp/test',
    prompt: inlinePrompt,
    systemPrompt: 'System instructions',
    promptFile: '/tmp/agent prompt.txt',
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/agent prompt.txt'));
  assert.ok(command.includes('codex'));
  assert.ok(!command.includes(inlinePrompt));
  assert.ok(!command.includes('System instructions'));
});

test('buildAgentCommand - claude can read prompt from file', () => {
  const inlinePrompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: inlinePrompt,
    systemPrompt: 'You are helpful',
    promptFile: '/tmp/agent prompt.txt',
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/agent prompt.txt'));
  assert.ok(command.includes('claude'));
  assert.ok(command.includes('--system-prompt'));
  assert.ok(command.includes('You are helpful'));
  assert.ok(!command.includes(inlinePrompt));
});

test('buildAgentCommand - qwen can read prompt from file', () => {
  const inlinePrompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
  const command = buildAgentCommand({
    tool: 'qwen',
    workingDirectory: '/tmp/test',
    prompt: inlinePrompt,
    systemPrompt: 'System instructions',
    promptFile: '/tmp/agent prompt.txt',
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/agent prompt.txt'));
  assert.ok(command.includes('qwen'));
  assert.ok(!command.includes(inlinePrompt));
  assert.ok(!command.includes('System instructions'));
});

test('buildAgentCommand - gemini can read prompt from file', () => {
  const inlinePrompt = "Secret prompt with 'quotes', $HOME, and `pwd`";
  const command = buildAgentCommand({
    tool: 'gemini',
    workingDirectory: '/tmp/test',
    prompt: inlinePrompt,
    systemPrompt: 'System instructions',
    promptFile: '/tmp/agent prompt.txt',
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/agent prompt.txt'));
  assert.ok(command.includes('gemini'));
  assert.ok(!command.includes(inlinePrompt));
  assert.ok(!command.includes('System instructions'));
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

test('buildAgentCommand - claude read-only uses plan permission mode', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: 'Plan only',
    readOnly: true,
    isolation: 'none',
  });

  assert.ok(command.includes('--permission-mode'));
  assert.ok(command.includes('plan'));
  assert.ok(!command.includes('--dangerously-skip-permissions'));
});

test('buildAgentCommand - claude supports raw passthrough options', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    prompt: 'Hello',
    executable: '/opt/Claude Code/bin/claude',
    extraEnv: {
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      MCP_TIMEOUT: '10000',
    },
    extraArgs: [
      '--mcp-config',
      '/tmp/mcp config.json',
      '--permission-mode',
      'default',
    ],
    skipDefaultSafetyFlags: true,
    isolation: 'none',
  });

  assert.ok(command.includes('env'));
  assert.ok(command.includes('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1'));
  assert.ok(command.includes('MCP_TIMEOUT=10000'));
  assert.ok(command.includes('/opt/Claude Code/bin/claude'));
  assert.ok(command.includes('--mcp-config'));
  assert.ok(command.includes('/tmp/mcp config.json'));
  assert.ok(command.includes('--permission-mode'));
  assert.ok(command.includes('default'));
  assert.ok(!command.includes('--dangerously-skip-permissions'));
});

test('buildAgentCommand - codex read-only uses sandbox and no approvals', () => {
  const command = buildAgentCommand({
    tool: 'codex',
    workingDirectory: '/tmp/test',
    prompt: 'Plan only',
    readOnly: true,
    isolation: 'none',
  });

  assert.ok(command.includes('codex --ask-for-approval never exec'));
  assert.ok(command.includes('--sandbox'));
  assert.ok(command.includes('read-only'));
  assert.ok(!command.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('buildAgentCommand - codex applies env to the tool side of prompt pipe', () => {
  const command = buildAgentCommand({
    tool: 'codex',
    workingDirectory: '/tmp/test',
    promptFile: '/tmp/prompt.txt',
    executable: '/opt/codex bin/codex',
    extraEnv: [['CODEX_HOME', '/tmp/codex home']],
    extraArgs: ['--config', 'model_reasoning_effort="high"'],
    skipDefaultSafetyFlags: true,
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/prompt.txt'));
  assert.ok(command.includes('| env CODEX_HOME='));
  assert.ok(command.includes('/tmp/codex home'));
  assert.ok(command.includes('/opt/codex bin/codex'));
  assert.ok(command.includes('--config'));
  assert.ok(command.includes('model_reasoning_effort='));
  assert.ok(!command.includes('--dangerously-bypass-approvals-and-sandbox'));
});

test('buildAgentCommand - qwen applies env to the tool side of prompt pipe', () => {
  const command = buildAgentCommand({
    tool: 'qwen',
    workingDirectory: '/tmp/test',
    promptFile: '/tmp/prompt.txt',
    executable: '/opt/qwen code/qwen',
    extraEnv: [['QWEN_HOME', '/tmp/qwen home']],
    extraArgs: ['--checkpointing', '--approval-mode', 'default'],
    skipDefaultSafetyFlags: true,
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/prompt.txt'));
  assert.ok(command.includes('| env QWEN_HOME='));
  assert.ok(command.includes('/tmp/qwen home'));
  assert.ok(command.includes('/opt/qwen code/qwen'));
  assert.ok(command.includes('--checkpointing'));
  assert.ok(command.includes('--approval-mode'));
  assert.ok(command.includes('default'));
  assert.ok(!command.includes('--yolo'));
});

test('buildAgentCommand - gemini applies env to the tool side of prompt pipe', () => {
  const command = buildAgentCommand({
    tool: 'gemini',
    workingDirectory: '/tmp/test',
    promptFile: '/tmp/prompt.txt',
    executable: '/opt/gemini cli/gemini',
    extraEnv: [['GEMINI_HOME', '/tmp/gemini home']],
    extraArgs: ['--telemetry', 'false'],
    skipDefaultSafetyFlags: true,
    isolation: 'none',
  });

  assert.ok(command.includes('cat'));
  assert.ok(command.includes('/tmp/prompt.txt'));
  assert.ok(command.includes('| env GEMINI_HOME='));
  assert.ok(command.includes('/tmp/gemini home'));
  assert.ok(command.includes('/opt/gemini cli/gemini'));
  assert.ok(command.includes('--telemetry'));
  assert.ok(command.includes('false'));
  assert.ok(!command.includes('--yolo'));
});

test('buildAgentCommand - opencode read-only denies shell and edits', () => {
  const command = buildAgentCommand({
    tool: 'opencode',
    workingDirectory: '/tmp/test',
    prompt: 'Plan only',
    readOnly: true,
    isolation: 'none',
  });

  assert.ok(command.includes('OPENCODE_PERMISSION='));
  assert.ok(command.includes('bash'));
  assert.ok(command.includes('edit'));
  assert.ok(command.includes('deny'));
});

test('buildAgentCommand - read-only still works with screen isolation', () => {
  const command = buildAgentCommand({
    tool: 'claude',
    workingDirectory: '/tmp/test',
    readOnly: true,
    isolation: 'screen',
    screenName: 'planning-session',
    detached: true,
  });

  assert.ok(command.includes('screen'));
  assert.ok(command.includes('planning-session'));
  assert.ok(command.includes('--permission-mode'));
  assert.ok(command.includes('plan'));
});

test('buildAgentCommand - agent read-only uses readonly permission mode', () => {
  const command = buildAgentCommand({
    tool: 'agent',
    workingDirectory: '/tmp/test',
    readOnly: true,
    isolation: 'none',
  });

  assert.ok(command.includes('--permission-mode'));
  assert.ok(command.includes('readonly'));
});

test('buildAgentCommand - agent plan-only uses plan permission mode', () => {
  const command = buildAgentCommand({
    tool: 'agent',
    workingDirectory: '/tmp/test',
    planOnly: true,
    isolation: 'none',
  });

  assert.ok(command.includes('--permission-mode'));
  assert.ok(command.includes('plan'));
  assert.ok(!command.includes('readonly'));
});

test('buildAgentCommand - read-only rejects unsupported tool', () => {
  assert.throws(() => {
    buildAgentCommand({
      tool: 'unknown-tool',
      workingDirectory: '/tmp/test',
      readOnly: true,
      isolation: 'none',
    });
  }, /does not support enforceable read-only mode/);
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
