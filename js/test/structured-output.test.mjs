/**
 * Tests for structured output (issue #57): the `jsonSchema` launch option
 * and the `structuredOutput` metadata field.
 */

import { mock, test } from 'node:test';
import assert from 'node:assert';
import {
  agent,
  buildAgentCommand,
  buildNormalizedResultMetadata,
  extractStructuredOutput,
  getTool,
  jsonSchemaArg,
} from '../src/index.mjs';
import { parseStartAgentArgs } from '../src/cli-parser.mjs';

const SCHEMA = {
  type: 'object',
  properties: { title: { type: 'string' } },
  required: ['title'],
  additionalProperties: false,
};
const SCHEMA_JSON = JSON.stringify(SCHEMA);

test('jsonSchemaArg accepts an object or JSON text and rejects the rest', () => {
  assert.strictEqual(jsonSchemaArg(SCHEMA), SCHEMA_JSON);
  assert.strictEqual(jsonSchemaArg(` ${SCHEMA_JSON} `), SCHEMA_JSON);
  assert.throws(() => jsonSchemaArg('{bad'), /jsonSchema is not valid JSON/);
  assert.throws(() => jsonSchemaArg('[1]'), TypeError);
  assert.throws(() => jsonSchemaArg('./schema.json'), /not valid JSON/);
});

test('claude and qwen pass the schema as --json-schema', () => {
  for (const toolName of ['claude', 'qwen']) {
    const args = getTool({ toolName }).buildArgs({
      prompt: 'hi',
      jsonSchema: SCHEMA,
    });
    const index = args.indexOf('--json-schema');
    assert.ok(index >= 0, `${toolName}: ${args.join(' ')}`);
    assert.strictEqual(args[index + 1], SCHEMA_JSON);
  }
});

test('codex gets --output-schema through bash process substitution', () => {
  const command = getTool({ toolName: 'codex' }).buildCommand({
    prompt: 'hi',
    jsonSchema: SCHEMA,
    resume: 'thread-1',
  });
  assert.match(
    command,
    /codex exec resume thread-1 .* --output-schema <\(printf '%s' "\{\\"type\\":\\"object\\"/
  );
  assert.ok(command.endsWith(')'), command);
  assert.doesNotMatch(
    getTool({ toolName: 'codex' }).buildCommand({ prompt: 'hi' }),
    /output-schema/
  );
});

test('tools without a native flag reject the option', () => {
  for (const tool of ['opencode', 'gemini', 'agent']) {
    assert.throws(
      () =>
        buildAgentCommand({
          tool,
          workingDirectory: '/tmp',
          prompt: 'hi',
          jsonSchema: SCHEMA,
        }),
      /does not support structured output.*claude, codex, qwen/
    );
  }
});

test('the CLI and the agent options reach the command', async () => {
  const parsed = parseStartAgentArgs([
    '--tool',
    'claude',
    '--working-directory',
    '/tmp',
    '--json-schema',
    SCHEMA_JSON,
  ]);
  assert.strictEqual(parsed.jsonSchema, SCHEMA_JSON);

  const controller = agent({
    tool: 'qwen',
    workingDirectory: '/tmp',
    prompt: 'hi',
    jsonSchema: SCHEMA,
  });
  const log = mock.method(console, 'log', () => {});
  try {
    await controller.start({ dryRun: true });
  } finally {
    log.mock.restore();
  }
  assert.match(log.mock.calls.at(-1).arguments[0], /--json-schema /);
});

test('structuredOutput comes from the Claude and Qwen result messages', () => {
  const claude = buildNormalizedResultMetadata({
    tool: 'claude',
    exitCode: 0,
    parsedOutput: [
      { type: 'system', subtype: 'init', session_id: 's' },
      {
        type: 'result',
        subtype: 'success',
        result: '',
        structured_output: { title: 'Fix login' },
      },
    ],
  });
  assert.deepStrictEqual(claude.structuredOutput, { title: 'Fix login' });

  const qwen = buildNormalizedResultMetadata({
    tool: 'qwen',
    exitCode: 0,
    parsedOutput: [
      {
        type: 'result',
        subtype: 'success',
        result: '{"title":"Fix login"}',
        structured_result: { title: 'Fix login' },
      },
    ],
  });
  assert.deepStrictEqual(qwen.structuredOutput, { title: 'Fix login' });
  assert.strictEqual(
    buildNormalizedResultMetadata({
      tool: 'claude',
      exitCode: 0,
      parsedOutput: [{ type: 'result', subtype: 'success', result: 'x' }],
    }).structuredOutput,
    null
  );
});

test('codex structured output is its final agent message, only on request', () => {
  const messages = [
    { type: 'thread.started', thread_id: 't' },
    {
      type: 'item.completed',
      item: { type: 'agent_message', text: '{"title":"Fix login"}' },
    },
    { type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } },
  ];
  assert.deepStrictEqual(
    extractStructuredOutput({ tool: 'codex', messages, requested: true }),
    { title: 'Fix login' }
  );
  assert.strictEqual(
    extractStructuredOutput({ tool: 'codex', messages }),
    null,
    'plain answers are not guessed as JSON'
  );
  assert.deepStrictEqual(
    extractStructuredOutput({
      tool: 'codex',
      plainOutput: '{"title":"Plain"}\n',
      requested: true,
    }),
    { title: 'Plain' },
    'codex exec without --json prints the final message'
  );
  assert.strictEqual(
    extractStructuredOutput({
      tool: 'codex',
      messages: [
        {
          type: 'item.completed',
          item: { type: 'agent_message', text: 'not json' },
        },
      ],
      requested: true,
    }),
    null
  );
});

test('an agent run reports the structured output in its metadata', async () => {
  const lines = [
    { type: 'thread.started', thread_id: 'thread-1' },
    {
      type: 'item.completed',
      item: { id: 'i', type: 'agent_message', text: '{"title":"Done"}' },
    },
    { type: 'turn.completed', usage: { input_tokens: 3, output_tokens: 2 } },
  ]
    .map((line) => `'${JSON.stringify(line)}'`)
    .join(' ');
  const controller = agent({
    tool: 'codex',
    workingDirectory: '/tmp',
    prompt: 'hi',
    json: true,
    jsonSchema: SCHEMA,
    toolOverrides: { buildCommand: () => `printf '%s\\n' ${lines}` },
  });
  await controller.start({ attached: false });
  const result = await controller.stop();
  assert.strictEqual(result.exitCode, 0);
  assert.deepStrictEqual(result.metadata.structuredOutput, { title: 'Done' });
});
