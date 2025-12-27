/**
 * Tests for streaming utilities
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  parseNdjsonLine,
  stringifyNdjsonLine,
} from '../src/streaming/ndjson.mjs';
import { JsonOutputStream } from '../src/streaming/output-stream.mjs';
import { JsonInputStream } from '../src/streaming/input-stream.mjs';

// NDJSON parsing tests
test('parseNdjsonLine - parses valid JSON object', () => {
  const result = parseNdjsonLine({ line: '{"type":"message"}' });
  assert.deepStrictEqual(result, { type: 'message' });
});

test('parseNdjsonLine - parses valid JSON array', () => {
  const result = parseNdjsonLine({ line: '[1, 2, 3]' });
  assert.deepStrictEqual(result, [1, 2, 3]);
});

test('parseNdjsonLine - returns null for empty line', () => {
  assert.strictEqual(parseNdjsonLine({ line: '' }), null);
  assert.strictEqual(parseNdjsonLine({ line: '   ' }), null);
});

test('parseNdjsonLine - returns null for non-JSON line', () => {
  assert.strictEqual(parseNdjsonLine({ line: 'hello world' }), null);
  assert.strictEqual(parseNdjsonLine({ line: '123' }), null);
});

test('parseNdjsonLine - returns null for invalid JSON', () => {
  assert.strictEqual(parseNdjsonLine({ line: '{invalid}' }), null);
});

test('parseNdjsonLine - trims whitespace', () => {
  const result = parseNdjsonLine({ line: '  {"type":"message"}  ' });
  assert.deepStrictEqual(result, { type: 'message' });
});

// NDJSON stringify tests
test('stringifyNdjsonLine - stringifies object', () => {
  const result = stringifyNdjsonLine({ value: { type: 'message' } });
  assert.strictEqual(result, '{"type":"message"}\n');
});

test('stringifyNdjsonLine - handles null', () => {
  const result = stringifyNdjsonLine({ value: null });
  assert.strictEqual(result, '');
});

test('stringifyNdjsonLine - handles undefined', () => {
  const result = stringifyNdjsonLine({ value: undefined });
  assert.strictEqual(result, '');
});

// JsonOutputStream tests
test('JsonOutputStream - processes single JSON line', () => {
  const stream = new JsonOutputStream();
  const messages = stream.process({ chunk: '{"type":"hello"}\n' });

  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual(messages[0], { type: 'hello' });
});

test('JsonOutputStream - processes multiple JSON lines', () => {
  const stream = new JsonOutputStream();
  const messages = stream.process({ chunk: '{"a":1}\n{"b":2}\n' });

  assert.strictEqual(messages.length, 2);
  assert.deepStrictEqual(messages[0], { a: 1 });
  assert.deepStrictEqual(messages[1], { b: 2 });
});

test('JsonOutputStream - handles partial lines across chunks', () => {
  const stream = new JsonOutputStream();

  // First chunk: partial line
  let messages = stream.process({ chunk: '{"type":"mes' });
  assert.strictEqual(messages.length, 0);

  // Second chunk: completes line
  messages = stream.process({ chunk: 'sage"}\n' });
  assert.strictEqual(messages.length, 1);
  assert.deepStrictEqual(messages[0], { type: 'message' });
});

test('JsonOutputStream - calls onMessage callback', () => {
  const received = [];
  const stream = new JsonOutputStream({
    onMessage: ({ message }) => received.push(message),
  });

  stream.process({ chunk: '{"a":1}\n{"b":2}\n' });

  assert.strictEqual(received.length, 2);
});

test('JsonOutputStream - getMessages returns all messages', () => {
  const stream = new JsonOutputStream();
  stream.process({ chunk: '{"a":1}\n' });
  stream.process({ chunk: '{"b":2}\n' });

  const messages = stream.getMessages();
  assert.strictEqual(messages.length, 2);
});

test('JsonOutputStream - flush processes remaining buffer', () => {
  const stream = new JsonOutputStream();
  stream.process({ chunk: '{"type":"final"}' }); // No trailing newline

  // Buffer should have content
  let messages = stream.getMessages();
  assert.strictEqual(messages.length, 0);

  // Flush should process remaining
  const flushed = stream.flush();
  assert.strictEqual(flushed.length, 1);
  assert.deepStrictEqual(flushed[0], { type: 'final' });
});

test('JsonOutputStream - filterByType', () => {
  const stream = new JsonOutputStream();
  stream.process({ chunk: '{"type":"a"}\n{"type":"b"}\n{"type":"a"}\n' });

  const filtered = stream.filterByType({ type: 'a' });
  assert.strictEqual(filtered.length, 2);
});

test('JsonOutputStream - reset clears state', () => {
  const stream = new JsonOutputStream();
  stream.process({ chunk: '{"a":1}\n' });
  stream.reset();

  assert.strictEqual(stream.getMessages().length, 0);
});

// JsonInputStream tests
test('JsonInputStream - add message', () => {
  const stream = new JsonInputStream();
  stream.add({ message: { type: 'hello' } });

  assert.strictEqual(stream.size(), 1);
});

test('JsonInputStream - toString produces NDJSON', () => {
  const stream = new JsonInputStream();
  stream.add({ message: { a: 1 } });
  stream.add({ message: { b: 2 } });

  const output = stream.toString();
  assert.strictEqual(output, '{"a":1}\n{"b":2}\n');
});

test('JsonInputStream - addPrompt adds user prompt', () => {
  const stream = new JsonInputStream();
  stream.addPrompt({ content: 'Hello' });

  const messages = stream.getMessages();
  assert.strictEqual(messages.length, 1);
  assert.strictEqual(messages[0].type, 'user_prompt');
  assert.strictEqual(messages[0].content, 'Hello');
});

test('JsonInputStream - addSystemMessage adds system message', () => {
  const stream = new JsonInputStream();
  stream.addSystemMessage({ content: 'You are helpful' });

  const messages = stream.getMessages();
  assert.strictEqual(messages[0].type, 'system');
});

test('JsonInputStream - chaining works', () => {
  const stream = new JsonInputStream()
    .addSystemMessage({ content: 'System' })
    .addPrompt({ content: 'User' })
    .add({ message: { custom: true } });

  assert.strictEqual(stream.size(), 3);
});

test('JsonInputStream - clear removes all messages', () => {
  const stream = new JsonInputStream();
  stream.add({ message: { a: 1 } });
  stream.clear();

  assert.strictEqual(stream.size(), 0);
});

test('JsonInputStream.from - creates from array', () => {
  const stream = JsonInputStream.from({
    messages: [{ a: 1 }, { b: 2 }],
  });

  assert.strictEqual(stream.size(), 2);
});

test('JsonInputStream - toBuffer returns Buffer', () => {
  const stream = new JsonInputStream();
  stream.add({ message: { test: true } });

  const buffer = stream.toBuffer();
  assert.ok(Buffer.isBuffer(buffer));
  assert.strictEqual(buffer.toString(), '{"test":true}\n');
});
