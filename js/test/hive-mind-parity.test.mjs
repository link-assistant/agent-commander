import { URL } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import {
  getTool,
  buildNormalizedResultMetadata,
  buildAgentCommand,
} from '../src/index.mjs';
import { escapeArg } from '../src/tools/shell.mjs';
import { executeCommand } from '../src/executor.mjs';
const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/hive-mind-parity.json', import.meta.url))
);
const catalog = JSON.parse(
  readFileSync(
    new URL(
      '../../docs/case-studies/issue-50/data/model-catalog.json',
      import.meta.url
    )
  )
);
for (const fixture of fixtures.usage) {
  test(`Hive Mind usage: ${fixture.name}`, () => {
    const actual = getTool({ toolName: fixture.tool }).extractUsage({
      output: fixture.events.map(JSON.stringify).join('\n'),
    });
    for (const [key, value] of Object.entries(fixture.usage)) {
      assert.equal(actual[key], value, key);
    }
  });
}
for (const fixture of fixtures.metadata) {
  test(`Hive Mind outcome: ${fixture.name}`, () => {
    const actual = buildNormalizedResultMetadata({
      tool: fixture.tool,
      exitCode: 0,
      parsedOutput: fixture.events,
      plainOutput: fixture.events.map(JSON.stringify).join('\n'),
    });
    for (const [key, value] of Object.entries(fixture.expected)) {
      assert.equal(actual[key], value, key);
    }
    if (fixture.subAgentId) {
      assert.equal(actual.subAgentCalls?.[0]?.id, fixture.subAgentId);
    }
  });
}
for (const [tool, models] of Object.entries(catalog.models)) {
  test(`Hive Mind bundled model aliases: ${tool}`, () => {
    const config = getTool({ toolName: tool });
    for (const [model, id] of Object.entries(models)) {
      assert.equal(config.mapModelToId({ model }), id, model);
    }
    assert.equal(config.defaultModel, catalog.defaults[tool]);
  });
}
test('Claude JSON commands select noninteractive verbose output', () => {
  const args = getTool({ toolName: 'claude' }).buildArgs({ json: true });
  for (const flag of ['-p', '--verbose']) {
    assert.ok(args.includes(flag), flag);
  }
});
test(
  'Shell arguments survive metacharacters',
  { skip: process.platform === 'win32' },
  async () => {
    const value = "one;two'&three|four";
    const command = `printf '%s' ${escapeArg(value)}`;
    const result = await executeCommand(command, { attached: false });
    assert.ok(result.stdout.includes(value));
  }
);
test(
  'Working directories with spaces are quoted',
  { skip: process.platform === 'win32' },
  async () => {
    const directory = mkdtempSync('/tmp/commander parity ');
    try {
      const command = buildAgentCommand({
        tool: 'pwd',
        workingDirectory: directory,
      });
      const result = await executeCommand(command, { attached: false });
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout.trim(), directory);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }
);
test(
  'Signal termination is unsuccessful',
  { skip: process.platform === 'win32' },
  async () => {
    const result = await executeCommand('kill -TERM $$', { attached: false });
    assert.notEqual(result.exitCode, 0);
  }
);
for (const tool of Object.keys(catalog.models)) {
  test(
    `Hive Mind controller receives ${tool} stdout independently of stderr`,
    { timeout: 10000, skip: process.platform === 'win32' },
    async () => {
      const { agent } = await import('../src/index.mjs');
      const { fileURLToPath } = await import('node:url');
      const controller = agent({
        tool,
        workingDirectory: '/tmp',
        prompt: 'Solve this\nExact bytes: &;',
        systemPrompt: 'System',
        json: true,
        toolOptions: {
          executable: fileURLToPath(
            new URL('./fixtures/fake-native-tool.mjs', import.meta.url)
          ),
          extraArgs: ['--fixture', tool],
        },
      });
      await controller.start({ attached: false });
      const result = await controller.stop();
      assert.equal(result.metadata.success, true);
      assert.notEqual(result.sessionId, 'stderr-session');
      assert.ok(
        !result.output.parsed.some(
          (event) => event.session_id === 'stderr-session'
        )
      );
      assert.ok(result.output.plain.includes('diagnostic only'));
      const input = result.output.parsed.find(
        (event) => event.type === 'fixture_input'
      );
      assert.equal(
        input.prompt,
        tool === 'claude'
          ? 'Solve this\nExact bytes: &;'
          : 'System\n\nSolve this\nExact bytes: &;'
      );
      const fixture = fixtures.usage.find((entry) => entry.tool === tool);
      for (const [key, value] of Object.entries(fixture.usage)) {
        assert.equal(result.usage[key], value, key);
      }
    }
  );
}
test(
  'A consumer can cancel a running controller',
  { timeout: 10000, skip: process.platform === 'win32' },
  async () => {
    const { agent } = await import('../src/index.mjs');
    const controller = agent({ tool: 'sleep 30', workingDirectory: '/tmp' });
    await controller.start({ attached: false });
    const result = await controller.cancel();
    assert.notEqual(result.exitCode, 0);
    assert.equal(result.metadata.success, false);
  }
);
test('Gemini resume is available through the common command builder', () => {
  const command = buildAgentCommand({
    tool: 'gemini',
    workingDirectory: '/tmp',
    resume: 'previous-session',
  });
  assert.ok(command.includes('--resume previous-session'));
});
test(
  'UTF-8 is preserved across process chunks',
  { timeout: 10000, skip: process.platform === 'win32' },
  async () => {
    const { fileURLToPath } = await import('node:url');
    const script = fileURLToPath(
      new URL('./fixtures/split-utf8.mjs', import.meta.url)
    );
    const result = await executeCommand(`node ${escapeArg(script)}`, {
      attached: false,
    });
    assert.equal(result.stdout, '🙂');
    assert.equal(result.stderr, '🙂');
  }
);

test(
  'Empty native JSON cannot report a completed session',
  { timeout: 10000, skip: process.platform === 'win32' },
  async () => {
    const { agent } = await import('../src/index.mjs');
    const controller = agent({
      tool: 'claude',
      workingDirectory: '/tmp',
      json: true,
      toolOptions: { executable: 'true' },
    });
    await controller.start({ attached: false });
    const result = await controller.stop();
    assert.equal(result.metadata.success, false);
    assert.equal(result.metadata.errorType, 'incomplete_stream');
  }
);

test('Published Rust fixtures match the common regression data', () => {
  const rustFixtures = JSON.parse(
    readFileSync(
      new URL(
        '../../rust/tests/fixtures/hive-mind-parity.json',
        import.meta.url
      )
    )
  );
  const rustCatalog = JSON.parse(
    readFileSync(
      new URL('../../rust/tests/fixtures/model-catalog.json', import.meta.url)
    )
  );
  assert.deepEqual(rustFixtures, fixtures);
  assert.deepEqual(rustCatalog, catalog);
});

test('OpenCode uses its native session flag for resume', () => {
  const command = buildAgentCommand({
    tool: 'opencode',
    workingDirectory: '/tmp',
    resume: 'previous-session',
  });
  assert.ok(command.includes('--session previous-session'));
});
test('Agent resumes the same session without forking', () => {
  const config = getTool({ toolName: 'agent' });
  assert.equal(config.supportsResume, true);
  const command = buildAgentCommand({
    tool: 'agent',
    workingDirectory: '/tmp',
    resume: 'previous-session',
  });
  assert.ok(command.includes('--resume previous-session --no-fork'));
});

test('Gemini parses a formatted JSON response and statistics', () => {
  const config = getTool({ toolName: 'gemini' });
  const event = fixtures.metadata.find(
    (entry) => entry.name === 'Gemini JSON object is a complete result'
  ).events[0];
  const output = JSON.stringify(event, null, 2);
  assert.deepEqual(config.parseOutput({ output }), [event]);
});

test(
  'Gemini controller collects formatted JSON without mixing stderr',
  { timeout: 10000, skip: process.platform === 'win32' },
  async () => {
    const { agent } = await import('../src/index.mjs');
    const { fileURLToPath } = await import('node:url');
    const controller = agent({
      tool: 'gemini',
      workingDirectory: '/tmp',
      prompt: 'Inspect',
      json: true,
      toolOptions: {
        executable: fileURLToPath(
          new URL('./fixtures/fake-native-tool.mjs', import.meta.url)
        ),
        extraArgs: ['--fixture', 'gemini', '--pretty-json'],
      },
    });
    await controller.start({ attached: false });
    const result = await controller.stop();
    assert.equal(result.metadata.success, true);
    assert.equal(result.metadata.resultSummary, 'Done');
    assert.equal(result.sessionId, 'pretty-session');
    assert.equal(result.usage.inputTokens, 30);
    assert.equal(result.output.parsed.length, 1);
  }
);
