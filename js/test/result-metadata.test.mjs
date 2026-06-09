/**
 * Tests for normalized result metadata.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { buildNormalizedResultMetadata } from '../src/index.mjs';

test('result metadata - normalizes Codex thread id and usage', () => {
  const metadata = buildNormalizedResultMetadata({
    tool: 'codex',
    exitCode: 0,
    plainOutput:
      '{"type":"session","thread_id":"thread-123"}\n{"type":"message","content":"Done."}',
    usage: {
      inputTokens: 12,
      outputTokens: 4,
    },
  });

  assert.strictEqual(metadata.tool, 'codex');
  assert.strictEqual(metadata.success, true);
  assert.strictEqual(metadata.sessionId, 'thread-123');
  assert.strictEqual(metadata.resultSummary, 'Done.');
  assert.deepStrictEqual(metadata.streamTokenUsage, {
    inputTokens: 12,
    outputTokens: 4,
  });
});

test('result metadata - classifies OpenCode usage limits', () => {
  const metadata = buildNormalizedResultMetadata({
    tool: 'opencode',
    exitCode: 1,
    plainOutput:
      'Usage limit reached. Please try again at 2026-05-01 18:30 UTC.',
  });

  assert.strictEqual(metadata.tool, 'opencode');
  assert.strictEqual(metadata.success, false);
  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.limitResetTime, '2026-05-01 18:30 UTC');
  assert.strictEqual(metadata.limitTimezone, 'UTC');
  assert.strictEqual(metadata.errorDuringExecution, true);
  assert.strictEqual(metadata.errorType, 'exit_code');
});

test('result metadata - exposes Agent pricing and sub-agent calls', () => {
  const metadata = buildNormalizedResultMetadata({
    tool: 'agent',
    exitCode: 0,
    parsedOutput: [
      {
        type: 'collab_tool_call',
        id: 'call-1',
        name: 'worker',
        status: 'completed',
        summary: 'Worker finished.',
      },
      {
        type: 'message',
        text: 'Final summary.',
      },
    ],
    usage: {
      inputTokens: 100,
      outputTokens: 40,
      totalCost: 0.004,
      stepCount: 1,
    },
  });

  assert.strictEqual(metadata.tool, 'agent');
  assert.strictEqual(metadata.success, true);
  assert.strictEqual(metadata.publicPricingEstimate, 0.004);
  assert.deepStrictEqual(metadata.pricingInfo, {
    totalCostUSD: 0.004,
    source: 'agent-stream-usage',
  });
  assert.strictEqual(metadata.resultSummary, 'Final summary.');
  assert.strictEqual(metadata.subAgentCalls.length, 1);
  assert.strictEqual(metadata.subAgentCalls[0].id, 'call-1');
});

test('result metadata - does not flag success as limit on ratelimit header names', () => {
  // Regression test for issue #37: Claude's stream-json output includes HTTP
  // response header names such as "anthropic-ratelimit-unified-5h-reset". These
  // must not be misread as a usage-limit signal on a fully successful run.
  const plainOutput = [
    '{"type":"system","subtype":"init","session_id":"sess-1"}',
    JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        usage: {
          input_tokens: 10,
          output_tokens: 1,
        },
      },
      raw_headers: {
        'anthropic-ratelimit-unified-5h-reset': '2026-06-09T23:00:00Z',
        'anthropic-ratelimit-requests-remaining': '999',
      },
    }),
    JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: false,
      result: '7',
      stop_reason: 'end_turn',
      terminal_reason: 'completed',
    }),
  ].join('\n');

  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 0,
    plainOutput,
  });

  assert.strictEqual(metadata.success, true);
  assert.strictEqual(metadata.limitReached, false);
  assert.strictEqual(metadata.limitResetTime, null);
  assert.strictEqual(metadata.errorDuringExecution, false);
  assert.strictEqual(metadata.resultSummary, '7');
});

test('result metadata - bare ratelimit substring does not match pattern', () => {
  // Without any structured success message, the tightened pattern must still
  // ignore a bare "ratelimit" substring (e.g. inside a header name).
  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 0,
    plainOutput:
      'logged header anthropic-ratelimit-unified-5h-reset during request',
  });

  assert.strictEqual(metadata.success, true);
  assert.strictEqual(metadata.limitReached, false);
});

test('result metadata - still detects genuine Claude usage limit', () => {
  // A real usage-limit run must still be classified as limit reached.
  const plainOutput = JSON.stringify({
    type: 'result',
    subtype: 'error_during_execution',
    is_error: true,
    result:
      'Claude AI usage limit reached. Please try again at 2026-06-10 09:00 UTC.',
  });

  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput,
  });

  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.success, false);
  assert.strictEqual(metadata.limitResetTime, '2026-06-10 09:00 UTC');
});
