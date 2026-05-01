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
