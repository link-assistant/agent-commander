/**
 * Tests for usage-limit detection ported from Hive Mind (issue #55).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildNormalizedResultMetadata,
  classifyRateLimitEvent,
  extractResetTime,
  extractTimezone,
  formatEpochResetTimeUtc,
  isUsageLimitText,
} from '../src/index.mjs';

const WEEKLY_LIMIT = "You've hit your weekly limit · resets 11am (UTC)";
const WEEKLY_RESET_EPOCH = 1792494000; // 2026-10-20T11:00:00Z

const DEBUG_429_BLOCK = [
  '[log_be123b] response error (error; no more retries left) {',
  '  url: "https://api.anthropic.com/v1/messages?beta=true",',
  '  status: 429,',
  '  headers: {',
  '    "anthropic-ratelimit-unified-5h-status": "allowed",',
  '    "anthropic-ratelimit-unified-7d-reset": "1792494000",',
  '    "anthropic-ratelimit-unified-7d-status": "rejected",',
  '    "anthropic-ratelimit-unified-representative-claim": "seven_day",',
  '    "anthropic-ratelimit-unified-reset": "1792494000",',
  '    "anthropic-ratelimit-unified-status": "rejected",',
  '    "retry-after": "56482",',
  '  },',
  '  message: undefined,',
  '}',
];
const BASE64_DUMP = 'Cfl40YOZK5u33blnr31i3MxYfHT5zEUjKBjXrhm2/98OPPp89'.repeat(
  4
);

test('usage limit - text patterns follow Hive Mind', () => {
  assert.ok(isUsageLimitText("You've hit your usage limit."));
  assert.ok(isUsageLimitText(WEEKLY_LIMIT));
  assert.ok(isUsageLimitText('Session limit reached ∙ resets 5pm'));
  assert.ok(isUsageLimitText('Limit resets Jan 15, 8am'));
  assert.ok(isUsageLimitText('rate_limit_exceeded'));
  // A transient server throttle is not an account usage limit (hive-mind#1924).
  assert.ok(
    !isUsageLimitText('API Error: Rate limited (not your usage limit)')
  );
  // "resets" followed by a word, and the literal word "month" (old typo).
  assert.ok(!isUsageLimitText('loads a shell and resets the state'));
  assert.ok(!isUsageLimitText('the counter resets monthly'));
});

test('usage limit - reset times are normalized for Hive Mind parseResetTime', () => {
  assert.strictEqual(
    extractResetTime(
      "You've hit your usage limit. Try again at Jun 11th, 2026 12:27 AM."
    ),
    'Jun 11, 2026, 12:27 AM'
  );
  assert.strictEqual(
    extractResetTime('Limit reached · resets Jan 15, 8am (Europe/Berlin)'),
    'Jan 15, 8:00 AM'
  );
  assert.strictEqual(extractResetTime(WEEKLY_LIMIT), '11:00 AM');
  assert.strictEqual(
    extractResetTime('Limit reached, resets 17:30'),
    '5:30 PM'
  );
  assert.strictEqual(
    extractResetTime(
      'Usage limit reached. Please try again at 2026-05-01 18:30 UTC.'
    ),
    '2026-05-01 18:30 UTC'
  );
  assert.strictEqual(extractTimezone(WEEKLY_LIMIT), 'UTC');
  assert.strictEqual(
    extractTimezone('resets 8am (Europe/Berlin)'),
    'Europe/Berlin'
  );
  // "AM" is not a timezone.
  assert.strictEqual(
    extractTimezone(
      'try again at Jun 11th, 2026 12:27 AM',
      'Jun 11th, 2026 12:27 AM'
    ),
    null
  );
  assert.strictEqual(
    formatEpochResetTimeUtc(WEEKLY_RESET_EPOCH),
    'Oct 20, 2026, 11:00 AM'
  );
});

test('usage limit - rate_limit_event classification', () => {
  assert.deepStrictEqual(
    classifyRateLimitEvent({
      status: 'rejected',
      resetsAt: WEEKLY_RESET_EPOCH,
      rateLimitType: 'seven_day',
    }),
    {
      reached: true,
      throttled: false,
      resetTime: 'Oct 20, 2026, 11:00 AM',
      timezone: 'UTC',
      resetsAt: WEEKLY_RESET_EPOCH,
      window: 'seven_day',
    }
  );
  // A warning below 100% is not a limit.
  assert.strictEqual(
    classifyRateLimitEvent({
      status: 'allowed_warning',
      resetsAt: WEEKLY_RESET_EPOCH,
      utilization: 0.97,
    }).reached,
    false
  );
  // Exhausted without overage is a limit.
  assert.strictEqual(
    classifyRateLimitEvent({
      status: 'allowed',
      resetsAt: WEEKLY_RESET_EPOCH,
      utilization: 1,
      overageStatus: 'rejected',
    }).reached,
    true
  );
  // Rejected without resetsAt is a throttle (hive-mind#1924).
  assert.deepStrictEqual(classifyRateLimitEvent({ status: 'rejected' }), {
    reached: false,
    throttled: true,
  });
});

test('result metadata - Codex usage limit from an error event', () => {
  const plainOutput = [
    { type: 'thread.started', thread_id: 'thread-limit' },
    { type: 'turn.started' },
    {
      type: 'error',
      message:
        "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at Jun 11th, 2026 12:27 AM.",
    },
    {
      type: 'turn.failed',
      error: { message: 'stream disconnected before completion' },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  const metadata = buildNormalizedResultMetadata({
    tool: 'codex',
    exitCode: 1,
    plainOutput,
  });

  assert.strictEqual(metadata.success, false);
  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.limitResetTime, 'Jun 11, 2026, 12:27 AM');
  assert.strictEqual(metadata.limitTimezone, null);
  assert.strictEqual(metadata.sessionId, 'thread-limit');
});

test('result metadata - Claude rate_limit_event epoch beats the text reset', () => {
  const plainOutput = [
    { type: 'system', subtype: 'init', session_id: 'sess-week' },
    {
      type: 'rate_limit_event',
      rate_limit_info: {
        status: 'rejected',
        resetsAt: WEEKLY_RESET_EPOCH,
        rateLimitType: 'seven_day',
      },
    },
    {
      type: 'assistant',
      is_api_error_message: true,
      error: 'rate_limit',
      message: { content: [{ type: 'text', text: WEEKLY_LIMIT }] },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: WEEKLY_LIMIT,
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput,
  });

  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.limitResetTime, 'Oct 20, 2026, 11:00 AM');
  assert.strictEqual(metadata.limitTimezone, 'UTC');
  assert.strictEqual(metadata.limitResetsAt, WEEKLY_RESET_EPOCH);
  assert.strictEqual(metadata.limitWindow, 'seven_day');
  assert.strictEqual(metadata.errorType, 'rate_limit');
  assert.strictEqual(metadata.errorMessage, WEEKLY_LIMIT);
});

test('result metadata - Claude weekly limit text alone keeps the 11am reset', () => {
  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput: JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      result: WEEKLY_LIMIT,
    }),
  });

  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.limitResetTime, '11:00 AM');
  assert.strictEqual(metadata.limitTimezone, 'UTC');
  assert.strictEqual(metadata.limitResetsAt, null);
});

test('result metadata - debug 429 headers identify the limit and are not the error message', () => {
  const plainOutput = [
    JSON.stringify({ type: 'system', subtype: 'init', session_id: 's' }),
    ...DEBUG_429_BLOCK,
    BASE64_DUMP,
  ].join('\n');

  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput,
  });

  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.limitResetTime, 'Oct 20, 2026, 11:00 AM');
  assert.strictEqual(metadata.limitTimezone, 'UTC');
  assert.strictEqual(metadata.limitWindow, 'seven_day');
  assert.strictEqual(metadata.errorMessage, 'Process exited with code 1');
});

test('result metadata - a server throttle is rate_limited, not a usage limit', () => {
  const text =
    'API Error: Server is temporarily limiting requests (not your usage limit) · Rate limited';
  const plainOutput = [
    {
      type: 'rate_limit_event',
      rate_limit_info: { status: 'rejected', isUsingOverage: false },
    },
    {
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      result: text,
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput,
  });

  assert.strictEqual(metadata.limitReached, false);
  assert.strictEqual(metadata.success, false);
  assert.strictEqual(metadata.errorType, 'rate_limited');
  assert.strictEqual(metadata.errorMessage, text);
});

test('result metadata - tool output that mentions limits is not a usage limit', () => {
  const plainOutput = [
    { type: 'system', subtype: 'init', session_id: 's' },
    {
      type: 'user',
      message: {
        content: [
          {
            type: 'tool_result',
            content: 'docs: usage limit reached. Please try again at 5pm',
          },
        ],
      },
    },
    {
      type: 'assistant',
      parent_tool_use_id: 'toolu_1',
      message: { content: [{ type: 'text', text: 'Limit reached' }] },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n');

  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput,
  });

  assert.strictEqual(metadata.limitReached, false);
});

test('result metadata - api_error usage_limit_reached is a limit', () => {
  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 1,
    plainOutput: JSON.stringify({
      type: 'result',
      subtype: 'error_during_execution',
      is_error: true,
      api_error: 'usage_limit_reached',
      result: 'Request failed',
    }),
  });

  assert.strictEqual(metadata.limitReached, true);
  assert.strictEqual(metadata.limitResetTime, null);
});
