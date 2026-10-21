/**
 * Balanced JSON record parsing (pretty-printed agent output, hive-mind#2119)
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  createJsonRecordScanner,
  parseJsonRecords,
} from '../src/streaming/json-records.mjs';
import { JsonOutputStream } from '../src/streaming/output-stream.mjs';
import { agentTool } from '../src/tools/agent.mjs';
import { buildNormalizedResultMetadata } from '../src/result-metadata.mjs';

const events = [
  { type: 'step_start', sessionID: 'ses_pretty', part: { type: 'step-start' } },
  {
    type: 'text',
    sessionID: 'ses_pretty',
    part: { type: 'text', text: '{ok}' },
  },
  {
    type: 'step_finish',
    sessionID: 'ses_pretty',
    part: {
      type: 'step-finish',
      reason: 'stop',
      tokens: { input: 7, output: 3 },
    },
  },
];
// `agent` without --compact-json prints indented records.
const pretty = events.map((event) => JSON.stringify(event, null, 2)).join('\n');

test('parseJsonRecords reads NDJSON, pretty-printed, and concatenated records', () => {
  assert.deepStrictEqual(parseJsonRecords(pretty), events);
  assert.deepStrictEqual(parseJsonRecords('{"a":1}{"b":2}\n[3]'), [
    { a: 1 },
    { b: 2 },
    [3],
  ]);
  assert.deepStrictEqual(
    parseJsonRecords('[INFO] ready {x}\n{"a":"}{"}\nplain'),
    [{ a: '}{' }]
  );
});

test('an unterminated record does not hide the records after it', () => {
  assert.deepStrictEqual(parseJsonRecords('{"cut":\n{"a":1}\n'), [{ a: 1 }]);
});

test('scanner keeps a record split across chunks until it balances', () => {
  const scanner = createJsonRecordScanner();
  assert.deepStrictEqual(scanner.write('{"type":\n  "te'), []);
  const [event] = scanner.write('xt"}\nnext line\n');
  assert.deepStrictEqual(event.value, { type: 'text' });
  assert.deepStrictEqual(scanner.flush(), []);
});

test('JsonOutputStream parses pretty-printed records line by line', () => {
  const stream = new JsonOutputStream();
  const lines = pretty.split('\n');
  const received = lines.flatMap((line) =>
    stream.process({ chunk: `${line}\n` })
  );
  assert.deepStrictEqual(received, events);
});

test('agent metadata is complete for default pretty-printed output', () => {
  const parsedOutput = agentTool.parseOutput({ output: pretty });
  assert.strictEqual(
    agentTool.extractSessionId({ output: pretty }),
    'ses_pretty'
  );
  assert.strictEqual(agentTool.extractUsage({ output: pretty }).inputTokens, 7);
  const metadata = buildNormalizedResultMetadata({
    tool: 'agent',
    exitCode: 0,
    plainOutput: pretty,
    parsedOutput,
  });
  assert.strictEqual(metadata.success, true);
  assert.strictEqual(metadata.sessionId, 'ses_pretty');
});
