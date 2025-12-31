/**
 * Tests for tool configurations
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  getTool,
  listTools,
  isToolSupported,
  claudeTool,
  codexTool,
  opencodeTool,
  agentTool,
} from '../src/tools/index.mjs';

test('listTools - returns all available tools', () => {
  const toolList = listTools();
  assert.ok(Array.isArray(toolList));
  assert.ok(toolList.includes('claude'));
  assert.ok(toolList.includes('codex'));
  assert.ok(toolList.includes('opencode'));
  assert.ok(toolList.includes('agent'));
});

test('isToolSupported - returns true for supported tools', () => {
  assert.strictEqual(isToolSupported({ toolName: 'claude' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'codex' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'opencode' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'agent' }), true);
});

test('isToolSupported - returns false for unsupported tools', () => {
  assert.strictEqual(isToolSupported({ toolName: 'unknown' }), false);
  assert.strictEqual(isToolSupported({ toolName: '' }), false);
});

test('getTool - returns tool configuration', () => {
  const claude = getTool({ toolName: 'claude' });
  assert.strictEqual(claude.name, 'claude');
  assert.strictEqual(claude.executable, 'claude');
  assert.ok(claude.supportsJsonOutput);
});

test('getTool - throws for unknown tool', () => {
  assert.throws(() => {
    getTool({ toolName: 'unknown' });
  }, /Unknown tool: unknown/);
});

// Claude tool tests
test('claudeTool - mapModelToId with alias', () => {
  assert.strictEqual(
    claudeTool.mapModelToId({ model: 'sonnet' }),
    'claude-sonnet-4-5-20250929'
  );
  assert.strictEqual(
    claudeTool.mapModelToId({ model: 'opus' }),
    'claude-opus-4-5-20251101'
  );
  assert.strictEqual(
    claudeTool.mapModelToId({ model: 'haiku' }),
    'claude-haiku-4-5-20251001'
  );
});

test('claudeTool - mapModelToId with full ID', () => {
  assert.strictEqual(
    claudeTool.mapModelToId({ model: 'claude-3-opus-20240229' }),
    'claude-3-opus-20240229'
  );
});

test('claudeTool - buildArgs with prompt', () => {
  const args = claudeTool.buildArgs({ prompt: 'Hello' });
  assert.ok(args.includes('--prompt'));
  assert.ok(args.includes('Hello'));
});

test('claudeTool - buildArgs with model', () => {
  const args = claudeTool.buildArgs({ model: 'sonnet' });
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('claude-sonnet-4-5-20250929'));
});

test('claudeTool - parseOutput with NDJSON', () => {
  const output = '{"type":"message","content":"Hello"}\n{"type":"done"}';
  const messages = claudeTool.parseOutput({ output });
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].type, 'message');
  assert.strictEqual(messages[1].type, 'done');
});

test('claudeTool - extractSessionId', () => {
  const output = '{"session_id":"abc123"}\n{"type":"done"}';
  const sessionId = claudeTool.extractSessionId({ output });
  assert.strictEqual(sessionId, 'abc123');
});

// Codex tool tests
test('codexTool - mapModelToId with alias', () => {
  assert.strictEqual(codexTool.mapModelToId({ model: 'gpt5' }), 'gpt-5');
  assert.strictEqual(codexTool.mapModelToId({ model: 'o3' }), 'o3');
});

test('codexTool - buildArgs includes exec mode', () => {
  const args = codexTool.buildArgs({});
  assert.ok(args.includes('exec'));
  assert.ok(args.includes('--json'));
});

test('codexTool - extractSessionId with thread_id', () => {
  const output = '{"thread_id":"thread-123"}\n{"type":"done"}';
  const sessionId = codexTool.extractSessionId({ output });
  assert.strictEqual(sessionId, 'thread-123');
});

// OpenCode tool tests
test('opencodeTool - mapModelToId with alias', () => {
  assert.strictEqual(
    opencodeTool.mapModelToId({ model: 'grok' }),
    'opencode/grok-code'
  );
  assert.strictEqual(
    opencodeTool.mapModelToId({ model: 'gemini' }),
    'google/gemini-pro'
  );
});

test('opencodeTool - buildArgs includes run mode', () => {
  const args = opencodeTool.buildArgs({});
  assert.ok(args.includes('run'));
  assert.ok(args.includes('--format'));
  assert.ok(args.includes('json'));
});

// Agent tool tests
test('agentTool - mapModelToId with alias', () => {
  assert.strictEqual(
    agentTool.mapModelToId({ model: 'grok' }),
    'opencode/grok-code'
  );
  assert.strictEqual(
    agentTool.mapModelToId({ model: 'sonnet' }),
    'anthropic/claude-3-5-sonnet'
  );
});

test('agentTool - buildArgs with model', () => {
  const args = agentTool.buildArgs({ model: 'grok' });
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('opencode/grok-code'));
});

test('agentTool - extractUsage from step_finish events', () => {
  const output = `{"type":"step_finish","part":{"tokens":{"input":100,"output":50},"cost":0}}
{"type":"step_finish","part":{"tokens":{"input":200,"output":75},"cost":0}}`;
  const usage = agentTool.extractUsage({ output });
  assert.strictEqual(usage.inputTokens, 300);
  assert.strictEqual(usage.outputTokens, 125);
  assert.strictEqual(usage.stepCount, 2);
});

test('agentTool - detectErrors finds error messages', () => {
  const output = '{"type":"error","message":"Something went wrong"}';
  const result = agentTool.detectErrors({ output });
  assert.ok(result.hasError);
  assert.strictEqual(result.errorType, 'error');
});

test('agentTool - detectErrors returns false for normal output', () => {
  const output = '{"type":"step_finish","part":{}}';
  const result = agentTool.detectErrors({ output });
  assert.strictEqual(result.hasError, false);
});
