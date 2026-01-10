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
  geminiTool,
} from '../src/tools/index.mjs';

test('listTools - returns all available tools', () => {
  const toolList = listTools();
  assert.ok(Array.isArray(toolList));
  assert.ok(toolList.includes('claude'));
  assert.ok(toolList.includes('codex'));
  assert.ok(toolList.includes('opencode'));
  assert.ok(toolList.includes('agent'));
  assert.ok(toolList.includes('gemini'));
});

test('isToolSupported - returns true for supported tools', () => {
  assert.strictEqual(isToolSupported({ toolName: 'claude' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'codex' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'opencode' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'agent' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'gemini' }), true);
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

// Claude tool - new capability tests (issue #3)
test('claudeTool - buildArgs includes --dangerously-skip-permissions by default', () => {
  const args = claudeTool.buildArgs({});
  assert.ok(args.includes('--dangerously-skip-permissions'));
});

test('claudeTool - buildArgs uses stream-json output format', () => {
  const args = claudeTool.buildArgs({ json: true });
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
  assert.ok(!args.includes('json')); // Should not include plain 'json'
});

test('claudeTool - buildArgs with fallback model', () => {
  const args = claudeTool.buildArgs({ model: 'opus', fallbackModel: 'sonnet' });
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('claude-opus-4-5-20251101'));
  assert.ok(args.includes('--fallback-model'));
  assert.ok(args.includes('claude-sonnet-4-5-20250929'));
});

test('claudeTool - buildArgs with append-system-prompt', () => {
  const args = claudeTool.buildArgs({
    appendSystemPrompt: 'Extra instructions',
  });
  assert.ok(args.includes('--append-system-prompt'));
  assert.ok(args.includes('Extra instructions'));
});

test('claudeTool - buildArgs with session management', () => {
  const args = claudeTool.buildArgs({
    sessionId: '123e4567-e89b-12d3-a456-426614174000',
    resume: 'abc123',
    forkSession: true,
  });
  assert.ok(args.includes('--session-id'));
  assert.ok(args.includes('123e4567-e89b-12d3-a456-426614174000'));
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('abc123'));
  assert.ok(args.includes('--fork-session'));
});

test('claudeTool - buildArgs with verbose mode', () => {
  const args = claudeTool.buildArgs({ verbose: true });
  assert.ok(args.includes('--verbose'));
});

test('claudeTool - buildArgs with input format stream-json', () => {
  const args = claudeTool.buildArgs({ jsonInput: true });
  assert.ok(args.includes('--input-format'));
  assert.ok(args.includes('stream-json'));
});

test('claudeTool - buildArgs with replay-user-messages', () => {
  const args = claudeTool.buildArgs({ replayUserMessages: true });
  assert.ok(args.includes('--replay-user-messages'));
});

test('claudeTool - buildArgs always includes dangerously-skip-permissions (not configurable)', () => {
  // dangerouslySkipPermissions is always enabled and not configurable
  const args = claudeTool.buildArgs({});
  assert.ok(args.includes('--dangerously-skip-permissions'));
  // Even if someone tries to pass the option, it should be ignored (the option doesn't exist anymore)
  const argsWithAnyOption = claudeTool.buildArgs({ someUnknownOption: false });
  assert.ok(argsWithAnyOption.includes('--dangerously-skip-permissions'));
});

test('claudeTool - supportsJsonInput is true', () => {
  assert.strictEqual(claudeTool.supportsJsonInput, true);
});

test('claudeTool - supports all new capability flags', () => {
  assert.strictEqual(claudeTool.supportsAppendSystemPrompt, true);
  assert.strictEqual(claudeTool.supportsForkSession, true);
  assert.strictEqual(claudeTool.supportsSessionId, true);
  assert.strictEqual(claudeTool.supportsFallbackModel, true);
  assert.strictEqual(claudeTool.supportsVerbose, true);
  assert.strictEqual(claudeTool.supportsReplayUserMessages, true);
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

// Gemini tool tests
test('geminiTool - mapModelToId with alias', () => {
  assert.strictEqual(
    geminiTool.mapModelToId({ model: 'flash' }),
    'gemini-2.5-flash'
  );
  assert.strictEqual(
    geminiTool.mapModelToId({ model: 'pro' }),
    'gemini-2.5-pro'
  );
  assert.strictEqual(
    geminiTool.mapModelToId({ model: '3-flash' }),
    'gemini-3-flash-preview'
  );
  assert.strictEqual(
    geminiTool.mapModelToId({ model: 'lite' }),
    'gemini-2.5-flash-lite'
  );
  assert.strictEqual(
    geminiTool.mapModelToId({ model: '3-pro' }),
    'gemini-3-pro-preview'
  );
});

test('geminiTool - mapModelToId with full ID', () => {
  assert.strictEqual(
    geminiTool.mapModelToId({ model: 'gemini-2.0-flash' }),
    'gemini-2.0-flash'
  );
});

test('geminiTool - buildArgs with prompt', () => {
  const args = geminiTool.buildArgs({ prompt: 'Hello', yolo: false });
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('Hello'));
});

test('geminiTool - buildArgs with model', () => {
  const args = geminiTool.buildArgs({ model: 'flash', yolo: false });
  assert.ok(args.includes('-m'));
  assert.ok(args.includes('gemini-2.5-flash'));
});

test('geminiTool - buildArgs with yolo mode', () => {
  const args = geminiTool.buildArgs({ yolo: true });
  assert.ok(args.includes('--yolo'));
});

test('geminiTool - buildArgs with sandbox mode', () => {
  const args = geminiTool.buildArgs({ sandbox: true, yolo: false });
  assert.ok(args.includes('--sandbox'));
});

test('geminiTool - buildArgs with json output', () => {
  const args = geminiTool.buildArgs({ json: true, yolo: false });
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
});

test('geminiTool - buildArgs with debug mode', () => {
  const args = geminiTool.buildArgs({ debug: true, yolo: false });
  assert.ok(args.includes('-d'));
});

test('geminiTool - buildArgs with checkpointing', () => {
  const args = geminiTool.buildArgs({ checkpointing: true, yolo: false });
  assert.ok(args.includes('--checkpointing'));
});

test('geminiTool - buildArgs with interactive mode', () => {
  const args = geminiTool.buildArgs({
    prompt: 'Hello',
    interactive: true,
    yolo: false,
  });
  assert.ok(args.includes('-i'));
  assert.ok(args.includes('Hello'));
  assert.ok(!args.includes('-p'));
});

test('geminiTool - parseOutput with NDJSON', () => {
  const output = '{"type":"message","content":"Hello"}\n{"type":"done"}';
  const messages = geminiTool.parseOutput({ output });
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].type, 'message');
  assert.strictEqual(messages[1].type, 'done');
});

test('geminiTool - extractSessionId', () => {
  const output = '{"session_id":"abc123"}\n{"type":"done"}';
  const sessionId = geminiTool.extractSessionId({ output });
  assert.strictEqual(sessionId, 'abc123');
});

test('geminiTool - extractSessionId with conversation_id', () => {
  const output = '{"conversation_id":"conv456"}\n{"type":"done"}';
  const sessionId = geminiTool.extractSessionId({ output });
  assert.strictEqual(sessionId, 'conv456');
});

test('geminiTool - extractUsage with standard format', () => {
  const output = '{"usage":{"input_tokens":100,"output_tokens":50}}';
  const usage = geminiTool.extractUsage({ output });
  assert.strictEqual(usage.inputTokens, 100);
  assert.strictEqual(usage.outputTokens, 50);
  assert.strictEqual(usage.totalTokens, 150);
});

test('geminiTool - extractUsage with Gemini format', () => {
  const output =
    '{"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":50,"totalTokenCount":150}}';
  const usage = geminiTool.extractUsage({ output });
  assert.strictEqual(usage.inputTokens, 100);
  assert.strictEqual(usage.outputTokens, 50);
  assert.strictEqual(usage.totalTokens, 150);
});

test('geminiTool - detectErrors with error', () => {
  const output = '{"type":"error","message":"Something went wrong"}';
  const result = geminiTool.detectErrors({ output });
  assert.ok(result.hasError);
  assert.strictEqual(result.errorType, 'error');
  assert.strictEqual(result.message, 'Something went wrong');
});

test('geminiTool - detectErrors returns false for normal output', () => {
  const output = '{"type":"message","content":"Hello"}';
  const result = geminiTool.detectErrors({ output });
  assert.strictEqual(result.hasError, false);
});

test('geminiTool - supportsYolo is true', () => {
  assert.strictEqual(geminiTool.supportsYolo, true);
});

test('geminiTool - supportsSandbox is true', () => {
  assert.strictEqual(geminiTool.supportsSandbox, true);
});

test('geminiTool - supportsCheckpointing is true', () => {
  assert.strictEqual(geminiTool.supportsCheckpointing, true);
});

test('geminiTool - supportsDebug is true', () => {
  assert.strictEqual(geminiTool.supportsDebug, true);
});

test('geminiTool - default model is gemini-2.5-flash', () => {
  assert.strictEqual(geminiTool.defaultModel, 'gemini-2.5-flash');
});
