/**
 * Tests for normalized usage windows (issue #57).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  applyCodexRolloutUsageWindows,
  buildNormalizedResultMetadata,
  claudeRateLimitWindows,
  codexRateLimitWindows,
  extractUsageWindows,
  mergeUsageWindows,
} from '../src/index.mjs';

const rateLimitEvent = (info) => ({
  type: 'rate_limit_event',
  rate_limit_info: info,
});

test('claude rate_limit_info becomes a session or weekly window', () => {
  assert.deepStrictEqual(
    claudeRateLimitWindows({
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      utilization: 0.41,
      resetsAt: 1792494000,
    }),
    [
      {
        id: 'five_hour',
        kind: 'session',
        label: 'Session',
        usedPercent: 41,
        resetsAt: 1792494000,
        windowDurationMins: 300,
      },
    ]
  );
  const [scoped] = claudeRateLimitWindows({
    rateLimitType: 'seven_day_opus',
    utilization: 1.2,
  });
  assert.deepStrictEqual(scoped, {
    id: 'seven_day_opus',
    kind: 'weekly',
    label: 'Weekly · opus',
    usedPercent: 100,
    resetsAt: null,
    windowDurationMins: 10080,
  });
  assert.strictEqual(
    claudeRateLimitWindows({ rateLimitType: 'overage', utilization: 0.5 })[0]
      .kind,
    'other'
  );
  assert.deepStrictEqual(claudeRateLimitWindows({ status: 'allowed' }), []);
  assert.deepStrictEqual(claudeRateLimitWindows(null), []);
});

test('codex rate_limits become windows in both casings', () => {
  const rollout = {
    limit_id: 'codex',
    primary: { used_percent: 100, window_minutes: 300, resets_at: 1792494000 },
    secondary: {
      used_percent: 41,
      window_minutes: 10080,
      resets_at: 1792900000,
    },
  };
  assert.deepStrictEqual(codexRateLimitWindows(rollout), [
    {
      id: 'primary',
      kind: 'session',
      label: 'Session',
      usedPercent: 100,
      resetsAt: 1792494000,
      windowDurationMins: 300,
    },
    {
      id: 'secondary',
      kind: 'weekly',
      label: 'Weekly',
      usedPercent: 41,
      resetsAt: 1792900000,
      windowDurationMins: 10080,
    },
  ]);
  // App-server casing, Free plan without a window length: monthly primary.
  assert.deepStrictEqual(
    codexRateLimitWindows({
      planType: 'free',
      primary: { usedPercent: 12.5, resetsAt: 1793000000 },
    }),
    [
      {
        id: 'primary',
        kind: 'monthly',
        label: 'Monthly',
        usedPercent: 12.5,
        resetsAt: 1793000000,
        windowDurationMins: 43200,
      },
    ]
  );
  // A model-specific allowance must not replace the main windows.
  assert.deepStrictEqual(
    codexRateLimitWindows({ ...rollout, limit_id: 'codex_spark' }),
    []
  );
  assert.deepStrictEqual(codexRateLimitWindows(undefined), []);
});

test('mergeUsageWindows keeps omitted windows and known resets', () => {
  const [session] = claudeRateLimitWindows({
    rateLimitType: 'five_hour',
    utilization: 0.2,
    resetsAt: 100,
  });
  const [weekly] = claudeRateLimitWindows({
    rateLimitType: 'seven_day',
    utilization: 0.5,
  });
  const merged = mergeUsageWindows(
    [weekly, session],
    [{ ...session, usedPercent: 30, resetsAt: null }]
  );
  assert.deepStrictEqual(
    merged.map(({ id, usedPercent, resetsAt }) => [id, usedPercent, resetsAt]),
    [
      ['five_hour', 30, 100],
      ['seven_day', 50, null],
    ]
  );
});

test('extractUsageWindows folds a stream and result metadata exposes it', () => {
  const messages = [
    rateLimitEvent({ rateLimitType: 'five_hour', utilization: 0.1 }),
    rateLimitEvent({ rateLimitType: 'seven_day', utilization: 0.6 }),
    rateLimitEvent({ rateLimitType: 'five_hour', utilization: 0.25 }),
    { type: 'result', subtype: 'success', result: 'ok' },
  ];
  assert.deepStrictEqual(
    extractUsageWindows(messages).map((window) => window.usedPercent),
    [25, 60]
  );
  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 0,
    parsedOutput: messages,
  });
  assert.strictEqual(metadata.usageWindows.length, 2);
  assert.deepStrictEqual(
    buildNormalizedResultMetadata({ tool: 'claude', exitCode: 0 }).usageWindows,
    []
  );
  // Rollout token_count events carry the snapshot under payload.
  assert.strictEqual(
    extractUsageWindows([
      {
        type: 'event_msg',
        payload: {
          type: 'token_count',
          rate_limits: { primary: { used_percent: 5 } },
        },
      },
    ])[0].usedPercent,
    5
  );
});

test('applyCodexRolloutUsageWindows reads the rollout snapshot', async () => {
  const codexHome = mkdtempSync(path.join(tmpdir(), 'ac-usage-windows-'));
  try {
    const threadId = '0199a213-81c0-7800-8aa1-bbab2a035a53';
    const dir = path.join(codexHome, 'sessions', '2026', '10', '22');
    mkdirSync(dir, { recursive: true });
    const event = {
      type: 'event_msg',
      payload: {
        type: 'token_count',
        rate_limits: {
          limit_id: 'codex',
          primary: { used_percent: 7, window_minutes: 300, resets_at: 1 },
        },
      },
    };
    writeFileSync(
      path.join(dir, `rollout-2026-10-22T10-00-00-${threadId}.jsonl`),
      `${JSON.stringify(event)}\n`
    );
    const metadata = { tool: 'codex', sessionId: threadId, usageWindows: [] };
    await applyCodexRolloutUsageWindows(metadata, { codexHome });
    assert.deepStrictEqual(
      metadata.usageWindows.map(({ id, usedPercent }) => [id, usedPercent]),
      [['primary', 7]]
    );
    const other = { tool: 'claude', sessionId: threadId, usageWindows: [] };
    await applyCodexRolloutUsageWindows(other, { codexHome });
    assert.deepStrictEqual(other.usageWindows, []);
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});
