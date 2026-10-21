/**
 * Tests for @link-assistant/agent error classification ported from Hive Mind
 * (hive-mind#2141, #3213, #3570; issue #55).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildNormalizedResultMetadata, getTool } from '../src/index.mjs';

const agentTool = getTool({ toolName: 'agent' });
const lines = (events) =>
  events.map((event) => JSON.stringify(event)).join('\n');

const failedReadPart = {
  type: 'tool',
  tool: 'read',
  state: { status: 'error', error: 'Error: File not found: /repo/e.g' },
};

test('agent - failed tool calls do not fail a completed run (hive-mind#3213)', () => {
  const plainOutput = lines([
    { type: 'step_start', sessionID: 'ses_tool' },
    {
      type: 'error',
      part: failedReadPart,
      message: failedReadPart.state.error,
    },
    { type: 'step_finish', part: { reason: 'tool-calls' } },
    { type: 'step_start', sessionID: 'ses_tool' },
    { type: 'text', part: { text: 'Done.' } },
    { type: 'step_finish', part: { reason: 'stop' } },
  ]);

  const metadata = buildNormalizedResultMetadata({
    tool: 'agent',
    exitCode: 0,
    plainOutput,
    toolConfig: agentTool,
  });

  assert.strictEqual(metadata.success, true);
  assert.strictEqual(metadata.errorDuringExecution, false);
});

test('agent - the last fatal error is reported, with its NamedError text', () => {
  const output = lines([
    {
      type: 'error',
      part: failedReadPart,
      message: failedReadPart.state.error,
    },
    { type: 'step_finish', part: { reason: 'tool-calls' } },
    {
      type: 'error',
      error: {
        name: 'ProviderAuthError',
        data: { message: 'Formal AI provider rejected the request' },
      },
    },
  ]);

  const detected = agentTool.detectErrors({ output });

  assert.strictEqual(detected.hasError, true);
  assert.strictEqual(detected.errorType, 'ProviderAuthError');
  assert.strictEqual(
    detected.message,
    'ProviderAuthError: Formal AI provider rejected the request'
  );
  assert.ok(!detected.message.includes('[object Object]'));
});

test('agent - a fatal model log record fails an exit-0 run (hive-mind#2141)', () => {
  const plainOutput = lines([
    {
      type: 'log',
      level: 'error',
      service: 'session.prompt',
      error: 'ProviderModelNotFoundError',
      hint: 'Check that the model exists in the provider',
      message:
        'Failed to initialize specified model - NOT falling back to default',
    },
    { type: 'session.idle' },
  ]);

  const metadata = buildNormalizedResultMetadata({
    tool: 'agent',
    exitCode: 0,
    plainOutput,
    toolConfig: agentTool,
  });

  assert.strictEqual(metadata.success, false);
  assert.strictEqual(metadata.errorType, 'ProviderModelNotFoundError');
  assert.strictEqual(
    metadata.errorMessage,
    'ProviderModelNotFoundError — Failed to initialize specified model - NOT falling back to default — hint: Check that the model exists in the provider'
  );
});

for (const exitCode of [0, 1]) {
  test(`agent - weekly limit then step_finish reason error (exit ${exitCode}, hive-mind#3570)`, () => {
    const plainOutput = lines([
      { type: 'step_start', sessionID: 'ses_limit' },
      {
        type: 'error',
        error: {
          name: 'APIError',
          data: { message: "You've hit your weekly limit · resets 11am (UTC)" },
        },
      },
      { type: 'step_finish', part: { reason: 'error' } },
    ]);

    const metadata = buildNormalizedResultMetadata({
      tool: 'agent',
      exitCode,
      plainOutput,
      toolConfig: agentTool,
    });

    assert.strictEqual(metadata.success, false);
    assert.strictEqual(metadata.limitReached, true);
    assert.strictEqual(metadata.limitResetTime, '11:00 AM');
    assert.strictEqual(metadata.limitTimezone, 'UTC');
    assert.strictEqual(metadata.errorType, 'APIError');
  });
}

test('agent - pretty-printed error records are classified', () => {
  const output = JSON.stringify(
    { type: 'error', error: { name: 'RetryTimeoutExceededError', data: {} } },
    null,
    2
  );

  const detected = agentTool.detectErrors({ output });

  assert.strictEqual(detected.hasError, true);
  assert.strictEqual(detected.message, 'RetryTimeoutExceededError');
});
