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
  qwenTool,
} from '../src/tools/index.mjs';

test('listTools - returns all available tools', () => {
  const toolList = listTools();
  assert.ok(Array.isArray(toolList));
  assert.ok(toolList.includes('claude'));
  assert.ok(toolList.includes('codex'));
  assert.ok(toolList.includes('opencode'));
  assert.ok(toolList.includes('agent'));
  assert.ok(toolList.includes('qwen'));
});

test('isToolSupported - returns true for supported tools', () => {
  assert.strictEqual(isToolSupported({ toolName: 'claude' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'codex' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'opencode' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'agent' }), true);
  assert.strictEqual(isToolSupported({ toolName: 'qwen' }), true);
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

// Qwen tool tests
test('qwenTool - mapModelToId with alias', () => {
  assert.strictEqual(
    qwenTool.mapModelToId({ model: 'qwen3-coder' }),
    'qwen3-coder-480a35'
  );
  assert.strictEqual(
    qwenTool.mapModelToId({ model: 'coder' }),
    'qwen3-coder-480a35'
  );
  assert.strictEqual(qwenTool.mapModelToId({ model: 'gpt-4o' }), 'gpt-4o');
});

test('qwenTool - mapModelToId with full ID', () => {
  assert.strictEqual(
    qwenTool.mapModelToId({ model: 'custom-model' }),
    'custom-model'
  );
});

test('qwenTool - buildArgs with prompt', () => {
  const args = qwenTool.buildArgs({ prompt: 'Hello' });
  assert.ok(args.includes('-p'));
  assert.ok(args.includes('Hello'));
});

test('qwenTool - buildArgs with model', () => {
  const args = qwenTool.buildArgs({ model: 'qwen3-coder' });
  assert.ok(args.includes('--model'));
  assert.ok(args.includes('qwen3-coder-480a35'));
});

test('qwenTool - buildArgs uses stream-json output format by default', () => {
  const args = qwenTool.buildArgs({});
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('stream-json'));
});

test('qwenTool - buildArgs with json output format', () => {
  const args = qwenTool.buildArgs({ streamJson: false, json: true });
  assert.ok(args.includes('--output-format'));
  assert.ok(args.includes('json'));
  assert.ok(!args.includes('stream-json'));
});

test('qwenTool - buildArgs includes --yolo by default', () => {
  const args = qwenTool.buildArgs({});
  assert.ok(args.includes('--yolo'));
});

test('qwenTool - buildArgs with --resume', () => {
  const args = qwenTool.buildArgs({ resume: 'session123' });
  assert.ok(args.includes('--resume'));
  assert.ok(args.includes('session123'));
});

test('qwenTool - buildArgs with --continue', () => {
  const args = qwenTool.buildArgs({ continueSession: true });
  assert.ok(args.includes('--continue'));
});

test('qwenTool - buildArgs with --all-files', () => {
  const args = qwenTool.buildArgs({ allFiles: true });
  assert.ok(args.includes('--all-files'));
});

test('qwenTool - buildArgs with --include-directories', () => {
  const args = qwenTool.buildArgs({ includeDirectories: ['src', 'lib'] });
  const dirIndex = args.indexOf('--include-directories');
  assert.ok(dirIndex !== -1);
  assert.ok(args.includes('src'));
  assert.ok(args.includes('lib'));
});

test('qwenTool - buildArgs with --include-partial-messages', () => {
  const args = qwenTool.buildArgs({
    streamJson: true,
    includePartialMessages: true,
  });
  assert.ok(args.includes('--include-partial-messages'));
});

test('qwenTool - parseOutput with NDJSON', () => {
  const output = '{"type":"message","content":"Hello"}\n{"type":"done"}';
  const messages = qwenTool.parseOutput({ output });
  assert.strictEqual(messages.length, 2);
  assert.strictEqual(messages[0].type, 'message');
  assert.strictEqual(messages[1].type, 'done');
});

test('qwenTool - extractSessionId', () => {
  const output = '{"session_id":"abc123"}\n{"type":"done"}';
  const sessionId = qwenTool.extractSessionId({ output });
  assert.strictEqual(sessionId, 'abc123');
});

test('qwenTool - extractSessionId with sessionId format', () => {
  const output = '{"sessionId":"xyz789"}\n{"type":"done"}';
  const sessionId = qwenTool.extractSessionId({ output });
  assert.strictEqual(sessionId, 'xyz789');
});

test('qwenTool - extractUsage from output', () => {
  const output = `{"usage":{"input_tokens":100,"output_tokens":50,"total_tokens":150}}
{"usage":{"input_tokens":200,"output_tokens":75}}`;
  const usage = qwenTool.extractUsage({ output });
  assert.strictEqual(usage.inputTokens, 300);
  assert.strictEqual(usage.outputTokens, 125);
  assert.strictEqual(usage.totalTokens, 150); // First message had explicit total
});

test('qwenTool - extractUsage calculates total if not provided', () => {
  const output = '{"usage":{"input_tokens":100,"output_tokens":50}}';
  const usage = qwenTool.extractUsage({ output });
  assert.strictEqual(usage.inputTokens, 100);
  assert.strictEqual(usage.outputTokens, 50);
  assert.strictEqual(usage.totalTokens, 150); // Calculated from input + output
});

test('qwenTool - detectErrors finds error messages', () => {
  const output = '{"type":"error","message":"Something went wrong"}';
  const result = qwenTool.detectErrors({ output });
  assert.ok(result.hasError);
  assert.strictEqual(result.errorType, 'error');
  assert.strictEqual(result.message, 'Something went wrong');
});

test('qwenTool - detectErrors with error field', () => {
  const output = '{"error":"API rate limit exceeded"}';
  const result = qwenTool.detectErrors({ output });
  assert.ok(result.hasError);
  assert.strictEqual(result.message, 'API rate limit exceeded');
});

test('qwenTool - detectErrors returns false for normal output', () => {
  const output = '{"type":"message","content":"Hello"}';
  const result = qwenTool.detectErrors({ output });
  assert.strictEqual(result.hasError, false);
});

test('qwenTool - capability flags are correct', () => {
  assert.strictEqual(qwenTool.supportsJsonOutput, true);
  assert.strictEqual(qwenTool.supportsJsonInput, true);
  assert.strictEqual(qwenTool.supportsResume, true);
  assert.strictEqual(qwenTool.supportsContinueSession, true);
  assert.strictEqual(qwenTool.supportsYolo, true);
  assert.strictEqual(qwenTool.supportsAllFiles, true);
  assert.strictEqual(qwenTool.supportsIncludeDirectories, true);
  assert.strictEqual(qwenTool.supportsIncludePartialMessages, true);
});

test('qwenTool - buildCommand constructs correct command', () => {
  const cmd = qwenTool.buildCommand({
    workingDirectory: '/tmp/project',
    prompt: 'Review code',
    model: 'qwen3-coder',
  });
  assert.ok(cmd.includes('qwen'));
  assert.ok(cmd.includes('-p'));
  assert.ok(cmd.includes('Review code'));
  assert.ok(cmd.includes('--model'));
  assert.ok(cmd.includes('qwen3-coder-480a35'));
});

test('qwenTool - buildCommand combines system and user prompt', () => {
  const cmd = qwenTool.buildCommand({
    workingDirectory: '/tmp/project',
    prompt: 'Review code',
    systemPrompt: 'You are helpful',
  });
  assert.ok(cmd.includes('You are helpful'));
  assert.ok(cmd.includes('Review code'));
});
