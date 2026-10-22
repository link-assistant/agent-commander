/**
 * Tests for context-window usage (issue #57).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyCodexRolloutContextUsage,
  buildNormalizedResultMetadata,
  claudeRequestContextTokens,
  codexRolloutContextUsage,
  extractContextUsage,
} from '../src/index.mjs';

const assistant = (usage, extra = {}) => ({
  type: 'assistant',
  message: { model: 'claude-opus-4-5-20251101', usage },
  ...extra,
});

const claudeRun = [
  { type: 'system', subtype: 'init', session_id: 's1' },
  assistant({
    input_tokens: 10,
    cache_creation_input_tokens: 2000,
    cache_read_input_tokens: 30000,
    output_tokens: 500,
  }),
  // A sub-agent fills its own context.
  assistant(
    { input_tokens: 150000, output_tokens: 1 },
    { parent_tool_use_id: 'toolu_1' }
  ),
  { type: 'system', subtype: 'compact_boundary' },
  assistant({
    input_tokens: 5,
    cache_read_input_tokens: 19995,
    output_tokens: 0,
  }),
  {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    modelUsage: {
      'claude-opus-4-5-20251101': { contextWindow: 200000 },
      'claude-haiku-4-5': { contextWindow: 100000 },
    },
  },
];

test('claude context usage folds the last and peak main-thread request', () => {
  assert.strictEqual(
    claudeRequestContextTokens({
      input_tokens: 1,
      cache_creation_input_tokens: 2,
      cache_read_input_tokens: 3,
      output_tokens: 4,
    }),
    10
  );
  assert.deepStrictEqual(extractContextUsage(claudeRun), {
    usedTokens: 20000,
    peakTokens: 32510,
    maxTokens: 200000,
    usedPercent: 10,
    model: 'claude-opus-4-5-20251101',
    compactions: 1,
  });
  assert.strictEqual(extractContextUsage([{ type: 'result' }]), null);
  const metadata = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 0,
    parsedOutput: claudeRun,
  });
  assert.strictEqual(metadata.contextUsage.usedTokens, 20000);
});

test('codex token_count and app-server tokenUsage give used and max tokens', () => {
  const tokenCount = (total, window) => ({
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { total_tokens: total },
        model_context_window: window,
      },
    },
  });
  assert.deepStrictEqual(
    extractContextUsage([tokenCount(90000, 272000), tokenCount(68000, 272000)]),
    {
      usedTokens: 68000,
      peakTokens: 90000,
      maxTokens: 272000,
      usedPercent: 25,
      model: null,
      compactions: 0,
    }
  );
  assert.strictEqual(
    extractContextUsage([
      {
        method: 'thread/tokenUsage/updated',
        params: {
          tokenUsage: { last: { totalTokens: 1000 }, modelContextWindow: 4000 },
        },
      },
    ]).usedPercent,
    25
  );
  const text = [tokenCount(5, 100), tokenCount(7, 100)]
    .map((event) => JSON.stringify(event))
    .join('\n');
  assert.strictEqual(codexRolloutContextUsage(text).usedTokens, 7);
});

test('applyCodexRolloutContextUsage reads the thread rollout', async (t) => {
  const codexHome = await mkdtemp(join(tmpdir(), 'agent-commander-ctx-'));
  t.after(() => rm(codexHome, { recursive: true, force: true }));
  const thread = '0199a213-81c0-7800-8aa1-bbab2a035a53';
  const dir = join(codexHome, 'sessions/2026/10/22');
  await mkdir(dir, { recursive: true });
  const event = {
    type: 'event_msg',
    payload: {
      type: 'token_count',
      info: {
        last_token_usage: { total_tokens: 1234 },
        model_context_window: 272000,
      },
    },
  };
  await writeFile(
    join(dir, `rollout-2026-10-22T10-00-00-${thread}.jsonl`),
    `${JSON.stringify(event)}\n`
  );
  const metadata = await applyCodexRolloutContextUsage(
    { tool: 'codex', sessionId: thread, contextUsage: null },
    { codexHome }
  );
  assert.strictEqual(metadata.contextUsage.usedTokens, 1234);
  assert.strictEqual(metadata.contextUsage.maxTokens, 272000);
  const claude = await applyCodexRolloutContextUsage(
    { tool: 'claude', sessionId: thread, contextUsage: null },
    { codexHome }
  );
  assert.strictEqual(claude.contextUsage, null);
});
