#!/usr/bin/env node
/**
 * Test script for Qwen Code CLI integration
 *
 * This script tests the Qwen tool configuration and integration without
 * requiring actual API authentication. For full E2E tests with API calls,
 * use the manual workflow or authenticate locally.
 *
 * Usage:
 *   node experiments/test-qwen-integration.mjs
 *
 * For authenticated testing:
 *   1. Install Qwen Code: npm install -g @qwen-code/qwen-code@latest
 *   2. Authenticate: qwen then /auth (use Qwen OAuth for free tier)
 *   3. Run this script with --live flag: node experiments/test-qwen-integration.mjs --live
 */

import { getTool, listTools, isToolSupported } from '../src/tools/index.mjs';

const isLive = process.argv.includes('--live');

console.log('🧪 Qwen Code CLI Integration Test\n');
console.log(
  `Mode: ${isLive ? 'LIVE (with API calls)' : 'Configuration only'}\n`
);

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    failed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

// Test 1: Qwen is in the tools list
test('qwen is listed in available tools', () => {
  const tools = listTools();
  assertTrue(tools.includes('qwen'), 'qwen should be in tools list');
});

// Test 2: Qwen is supported
test('qwen is marked as supported', () => {
  assertTrue(isToolSupported({ toolName: 'qwen' }), 'qwen should be supported');
});

// Test 3: Get qwen tool configuration
test('getTool returns qwen configuration', () => {
  const tool = getTool({ toolName: 'qwen' });
  assertEqual(tool.name, 'qwen', 'tool name');
  assertEqual(tool.executable, 'qwen', 'executable name');
});

// Test 4: Model mapping - aliases
test('model mapping: qwen3-coder alias', () => {
  const tool = getTool({ toolName: 'qwen' });
  const mapped = tool.mapModelToId({ model: 'qwen3-coder' });
  assertEqual(mapped, 'qwen3-coder-480a35', 'qwen3-coder mapping');
});

test('model mapping: coder alias', () => {
  const tool = getTool({ toolName: 'qwen' });
  const mapped = tool.mapModelToId({ model: 'coder' });
  assertEqual(mapped, 'qwen3-coder-480a35', 'coder mapping');
});

test('model mapping: pass-through for unknown models', () => {
  const tool = getTool({ toolName: 'qwen' });
  const mapped = tool.mapModelToId({ model: 'custom-model-xyz' });
  assertEqual(mapped, 'custom-model-xyz', 'pass-through mapping');
});

// Test 5: Build arguments
test('buildArgs includes prompt', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({ prompt: 'Hello world' });
  assertTrue(args.includes('-p'), 'should include -p flag');
  assertTrue(args.includes('Hello world'), 'should include prompt text');
});

test('buildArgs includes model', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({ model: 'qwen3-coder' });
  assertTrue(args.includes('--model'), 'should include --model flag');
  assertTrue(
    args.includes('qwen3-coder-480a35'),
    'should include mapped model ID'
  );
});

test('buildArgs includes --yolo by default', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({});
  assertTrue(args.includes('--yolo'), 'should include --yolo by default');
});

test('buildArgs includes stream-json by default', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({});
  assertTrue(
    args.includes('--output-format'),
    'should include --output-format flag'
  );
  assertTrue(args.includes('stream-json'), 'should include stream-json value');
});

test('buildArgs with --resume', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({ resume: 'session-123' });
  assertTrue(args.includes('--resume'), 'should include --resume flag');
  assertTrue(args.includes('session-123'), 'should include session ID');
});

test('buildArgs with --continue', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({ continueSession: true });
  assertTrue(args.includes('--continue'), 'should include --continue flag');
});

test('buildArgs with --all-files', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({ allFiles: true });
  assertTrue(args.includes('--all-files'), 'should include --all-files flag');
});

test('buildArgs with --include-directories', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({ includeDirectories: ['src', 'lib'] });
  assertTrue(
    args.includes('--include-directories'),
    'should include --include-directories flag'
  );
  assertTrue(args.includes('src'), 'should include src directory');
  assertTrue(args.includes('lib'), 'should include lib directory');
});

test('buildArgs with --include-partial-messages', () => {
  const tool = getTool({ toolName: 'qwen' });
  const args = tool.buildArgs({
    streamJson: true,
    includePartialMessages: true,
  });
  assertTrue(
    args.includes('--include-partial-messages'),
    'should include --include-partial-messages flag'
  );
});

// Test 6: Build command
test('buildCommand produces valid command string', () => {
  const tool = getTool({ toolName: 'qwen' });
  const cmd = tool.buildCommand({
    workingDirectory: '/tmp/test',
    prompt: 'Test prompt',
    model: 'coder',
  });
  assertTrue(cmd.startsWith('qwen'), 'command should start with qwen');
  assertTrue(cmd.includes('-p'), 'command should include -p flag');
  assertTrue(cmd.includes('Test prompt'), 'command should include prompt');
});

test('buildCommand combines system and user prompt', () => {
  const tool = getTool({ toolName: 'qwen' });
  const cmd = tool.buildCommand({
    workingDirectory: '/tmp/test',
    prompt: 'User prompt',
    systemPrompt: 'System prompt',
  });
  assertTrue(cmd.includes('System prompt'), 'should include system prompt');
  assertTrue(cmd.includes('User prompt'), 'should include user prompt');
});

// Test 7: Parse output (NDJSON)
test('parseOutput handles valid NDJSON', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"type":"message","content":"Hello"}\n{"type":"done"}';
  const messages = tool.parseOutput({ output });
  assertEqual(messages.length, 2, 'message count');
  assertEqual(messages[0].type, 'message', 'first message type');
  assertEqual(messages[1].type, 'done', 'second message type');
});

test('parseOutput skips invalid JSON lines', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"type":"message"}\nnot json\n{"type":"done"}';
  const messages = tool.parseOutput({ output });
  assertEqual(messages.length, 2, 'should skip invalid lines');
});

test('parseOutput handles empty output', () => {
  const tool = getTool({ toolName: 'qwen' });
  const messages = tool.parseOutput({ output: '' });
  assertEqual(messages.length, 0, 'empty output should return empty array');
});

// Test 8: Extract session ID
test('extractSessionId finds session_id', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"session_id":"abc123"}\n{"type":"done"}';
  const sessionId = tool.extractSessionId({ output });
  assertEqual(sessionId, 'abc123', 'session ID');
});

test('extractSessionId finds sessionId (camelCase)', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"sessionId":"xyz789"}\n{"type":"done"}';
  const sessionId = tool.extractSessionId({ output });
  assertEqual(sessionId, 'xyz789', 'session ID (camelCase)');
});

test('extractSessionId returns null when not found', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"type":"message"}\n{"type":"done"}';
  const sessionId = tool.extractSessionId({ output });
  assertEqual(sessionId, null, 'should return null');
});

// Test 9: Extract usage
test('extractUsage aggregates token counts', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output =
    '{"usage":{"input_tokens":100,"output_tokens":50}}\n{"usage":{"input_tokens":200,"output_tokens":75}}';
  const usage = tool.extractUsage({ output });
  assertEqual(usage.inputTokens, 300, 'input tokens');
  assertEqual(usage.outputTokens, 125, 'output tokens');
});

test('extractUsage calculates total when not provided', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"usage":{"input_tokens":100,"output_tokens":50}}';
  const usage = tool.extractUsage({ output });
  assertEqual(usage.totalTokens, 150, 'calculated total');
});

// Test 10: Detect errors
test('detectErrors finds type:error messages', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"type":"error","message":"Something went wrong"}';
  const result = tool.detectErrors({ output });
  assertTrue(result.hasError, 'should detect error');
  assertEqual(result.message, 'Something went wrong', 'error message');
});

test('detectErrors finds error field', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"error":"API rate limit exceeded"}';
  const result = tool.detectErrors({ output });
  assertTrue(result.hasError, 'should detect error');
  assertEqual(result.message, 'API rate limit exceeded', 'error message');
});

test('detectErrors returns false for normal output', () => {
  const tool = getTool({ toolName: 'qwen' });
  const output = '{"type":"message","content":"Hello"}';
  const result = tool.detectErrors({ output });
  assertEqual(result.hasError, false, 'should not detect error');
});

// Test 11: Capability flags
test('capability flags are set correctly', () => {
  const tool = getTool({ toolName: 'qwen' });
  assertTrue(tool.supportsJsonOutput, 'supportsJsonOutput');
  assertTrue(tool.supportsJsonInput, 'supportsJsonInput');
  assertTrue(tool.supportsResume, 'supportsResume');
  assertTrue(tool.supportsContinueSession, 'supportsContinueSession');
  assertTrue(tool.supportsYolo, 'supportsYolo');
  assertTrue(tool.supportsAllFiles, 'supportsAllFiles');
  assertTrue(tool.supportsIncludeDirectories, 'supportsIncludeDirectories');
  assertTrue(
    tool.supportsIncludePartialMessages,
    'supportsIncludePartialMessages'
  );
});

// Summary
console.log(`\n${'='.repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(50));

if (failed > 0) {
  console.log('\n❌ Some tests failed');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  if (!isLive) {
    console.log('\n💡 To run live tests with API calls:');
    console.log(
      '   1. Install Qwen Code: npm install -g @qwen-code/qwen-code@latest'
    );
    console.log('   2. Authenticate: qwen then /auth');
    console.log('   3. Run: node experiments/test-qwen-integration.mjs --live');
  }
  process.exit(0);
}
