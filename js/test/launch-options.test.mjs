/**
 * Tests for the shared launch options (issue #57): reasoning effort, MCP
 * servers, strict MCP configuration, extra workspace directories and file
 * attachments.
 */

import { mock, test } from 'node:test';
import assert from 'node:assert';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath, URL } from 'node:url';
import {
  agent,
  buildAgentCommand,
  codexMcpServersOverride,
  getLaunchCapabilities,
  getTool,
  mcpConfigArg,
  normalizeAdditionalDirectories,
  normalizeAttachments,
  normalizeReasoningEffort,
  toTomlValue,
} from '../src/index.mjs';
import { parseStartAgentArgs } from '../src/cli-parser.mjs';
import { tools } from '../src/tools/index.mjs';

const MCP = {
  mcpServers: {
    upcomputer: {
      type: 'http',
      url: 'http://127.0.0.1:4100/mcp',
      headers: { Authorization: 'Bearer t' },
    },
    'local fs': { command: 'npx', args: ['-y', 'fs-mcp'], env: { A: '1' } },
  },
};

const args = (toolName, options) =>
  getTool({ toolName }).buildArgs({ prompt: 'hi', ...options });

const cliPath = fileURLToPath(
  new URL('../bin/start-agent.mjs', import.meta.url)
);
const generationBase = {
  workingDirectory: process.cwd(),
  prompt: 'hello',
};

test('generation capabilities report native controls for every tool', () => {
  for (const tool of Object.values(tools)) {
    const capabilities = getLaunchCapabilities(tool);
    assert.equal(
      capabilities.maxOutputTokens,
      ['claude', 'opencode'].includes(tool.name),
      tool.name
    );
    assert.equal(capabilities.temperature, tool.name === 'agent', tool.name);
  }
});

test('Agent forwards temperature zero via its native flag', () => {
  const result = args('agent', { temperature: 0 });
  const index = result.indexOf('--temperature');
  assert.notEqual(index, -1);
  assert.equal(result[index + 1], '0');
});

test('OpenCode forwards the output budget alongside its read-only policy', () => {
  const command = buildAgentCommand({
    ...generationBase,
    tool: 'opencode',
    isolation: 'docker',
    readOnly: true,
    maxOutputTokens: 128,
  });
  assert.match(
    command,
    /OPENCODE_EXPERIMENTAL_OUTPUT_TOKEN_MAX=128 opencode run/
  );
  assert.match(command, /OPENCODE_PERMISSION=/);
});

test('unsupported generation options fail before launch', async () => {
  for (const [tool, option, flag] of [
    ['codex', { maxOutputTokens: 128 }, '--max-output-tokens'],
    ['claude', { temperature: 0 }, '--temperature'],
    ['custom-tool', { temperature: 0.1 }, '--temperature'],
  ]) {
    const expected = new RegExp(`Tool "${tool}" does not support.*${flag}`);
    assert.throws(
      () => buildAgentCommand({ ...generationBase, tool, ...option }),
      expected
    );
    await assert.rejects(
      agent({ ...generationBase, tool, ...option }).start(),
      expected
    );
  }
});

test('invalid library generation values are rejected', () => {
  for (const maxOutputTokens of [0, 1.5, Infinity, '128', false]) {
    assert.throws(
      () =>
        buildAgentCommand({
          ...generationBase,
          tool: 'claude',
          maxOutputTokens,
        }),
      /--max-output-tokens.*positive/
    );
  }
  for (const temperature of [-0.1, Infinity, NaN, '0.1', false]) {
    assert.throws(
      () =>
        buildAgentCommand({ ...generationBase, tool: 'agent', temperature }),
      /--temperature.*non-negative/
    );
  }
});

test('start-agent parses generation flags and rejects missing or invalid values', () => {
  const denoArgs =
    typeof globalThis.Deno === 'undefined'
      ? []
      : [
          'run',
          '--no-lock',
          '--allow-read',
          '--allow-env',
          '--allow-sys=osRelease',
        ];
  const base = [
    ...denoArgs,
    cliPath,
    '--working-directory',
    process.cwd(),
    '--dry-run',
  ];
  assert.match(
    execFileSync(
      process.execPath,
      [...base, '--tool', 'agent', '--temperature=0.1'],
      { encoding: 'utf8' }
    ),
    /--temperature 0\.1/
  );
  assert.match(
    execFileSync(
      process.execPath,
      [...base, '--tool', 'claude', '--max-output-tokens', '128'],
      { encoding: 'utf8' }
    ),
    /CLAUDE_CODE_MAX_OUTPUT_TOKENS=128/
  );
  for (const [flag, ...values] of [
    ['--temperature'],
    ['--max-output-tokens', '1.5'],
    ['--max-output-tokens', '128', '--max-output-tokens=256'],
  ]) {
    const result = spawnSync(
      process.execPath,
      [...base, '--tool', 'claude', flag, ...values],
      { encoding: 'utf8' }
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, new RegExp(flag));
  }
  const unsupported = spawnSync(
    process.execPath,
    [...base, '--tool', 'codex', '--max-output-tokens=128'],
    { encoding: 'utf8' }
  );
  assert.equal(unsupported.status, 1);
  assert.match(
    unsupported.stderr,
    /Tool "codex" does not support.*--max-output-tokens/
  );
});

test('claude maps every launch option before --model', () => {
  const result = args('claude', {
    reasoningEffort: 'xhigh',
    mcpConfig: MCP,
    strictMcpConfig: true,
    additionalDirectories: ['/a', '/b'],
    model: 'opus',
  });
  const modelIndex = result.indexOf('--model');
  assert.deepStrictEqual(
    result.slice(result.indexOf('--add-dir'), modelIndex),
    [
      '--add-dir',
      '/a',
      '--add-dir',
      '/b',
      '--mcp-config',
      JSON.stringify(MCP),
      '--strict-mcp-config',
      '--effort',
      'xhigh',
    ]
  );
});

test('claude passes a path mcpConfig through unchanged', () => {
  const result = args('claude', { mcpConfig: './mcp.json' });
  assert.strictEqual(result[result.indexOf('--mcp-config') + 1], './mcp.json');
});

test('codex maps effort and MCP servers to -c overrides', () => {
  const result = args('codex', {
    reasoningEffort: 'high',
    mcpConfig: MCP,
    additionalDirectories: '/shared',
  });
  assert.ok(result.includes('model_reasoning_effort=high'));
  assert.deepStrictEqual(
    result.slice(result.indexOf('--add-dir'), result.indexOf('--add-dir') + 2),
    ['--add-dir', '/shared']
  );
  assert.ok(
    result.includes(
      'mcp_servers={upcomputer = {url = "http://127.0.0.1:4100/mcp", http_headers = {Authorization = "Bearer t"}}, "local fs" = {command = "npx", args = ["-y", "fs-mcp"], env = {A = "1"}}}'
    )
  );
});

test('codex keeps exec-level flags before resume (regression)', () => {
  // `codex exec resume` rejects --sandbox and --add-dir (codex 0.163).
  const result = args('codex', {
    resume: 'thread-1',
    readOnly: true,
    additionalDirectories: ['/x'],
  });
  const resumeIndex = result.indexOf('resume');
  assert.ok(resumeIndex > 0);
  assert.ok(result.indexOf('--sandbox') < resumeIndex);
  assert.ok(result.indexOf('--add-dir') < resumeIndex);
  assert.strictEqual(result[resumeIndex + 1], 'thread-1');
});

test('codex attaches each image with its own --image flag', () => {
  // codex 0.163 takes `--image <FILE>` in `exec` and `exec resume`.
  const result = args('codex', {
    resume: 'thread-1',
    attachments: ['shot.png', '/tmp/b.jpg'],
  });
  const resumeIndex = result.indexOf('resume');
  const imageIndex = result.indexOf('--image');
  assert.ok(imageIndex > resumeIndex);
  assert.deepStrictEqual(result.slice(imageIndex, imageIndex + 4), [
    '--image',
    'shot.png',
    '--image',
    '/tmp/b.jpg',
  ]);
  // The variadic flag is always followed by another flag.
  assert.match(result[imageIndex + 4], /^--/);
});

test('opencode attaches files with --file right after run', () => {
  const result = args('opencode', {
    attachments: 'diagram.png',
    extraArgs: ['positional'],
  });
  assert.deepStrictEqual(result.slice(0, 4), [
    'run',
    '--file',
    'diagram.png',
    '--format',
  ]);
});

test('codex rejects an MCP config file path', () => {
  assert.throws(
    () => args('codex', { mcpConfig: './mcp.json' }),
    /not a file path/
  );
});

test('opencode maps reasoning effort to --variant', () => {
  const result = args('opencode', { reasoningEffort: 'max' });
  assert.deepStrictEqual(result.slice(-2), ['--variant', 'max']);
});

test('gemini and qwen map additional directories', () => {
  assert.deepStrictEqual(
    args('gemini', { additionalDirectories: ['/d'] }).filter(
      (arg) => arg === '--include-directories' || arg === '/d'
    ),
    ['--include-directories', '/d']
  );
  const qwen = args('qwen', {
    includeDirectories: ['/a'],
    additionalDirectories: ['/b'],
    mcpConfig: './mcp.json',
  });
  assert.deepStrictEqual(qwen.slice(qwen.indexOf('--include-directories')), [
    '--include-directories',
    '/a',
    '--include-directories',
    '/b',
    '--mcp-config',
    './mcp.json',
  ]);
});

test('buildAgentCommand rejects options a tool cannot honor', () => {
  const base = { workingDirectory: '/tmp', prompt: 'hi' };
  assert.throws(
    () => buildAgentCommand({ ...base, tool: 'agent', reasoningEffort: 'low' }),
    /Tool "agent" does not support reasoning effort.*claude, codex, opencode/
  );
  assert.throws(
    () =>
      buildAgentCommand({
        ...base,
        tool: 'codex',
        mcpConfig: MCP,
        strictMcpConfig: true,
      }),
    /does not support strict MCP configuration.*Choose one of: claude;/
  );
  assert.throws(
    () =>
      buildAgentCommand({
        ...base,
        tool: 'opencode',
        additionalDirectories: ['/x'],
      }),
    /does not support additional directories/
  );
  assert.throws(
    () => buildAgentCommand({ ...base, tool: 'claude', attachments: 'a.png' }),
    /Tool "claude" does not support file attachments.*Choose one of: codex, opencode;/
  );
  // Empty lists and false flags are not requests.
  assert.doesNotThrow(() =>
    buildAgentCommand({
      ...base,
      tool: 'agent',
      additionalDirectories: [],
      attachments: [],
      strictMcpConfig: false,
    })
  );
});

test('agent() forwards first-class launch options', async () => {
  const controller = agent({
    tool: 'claude',
    workingDirectory: '/tmp',
    prompt: 'hi',
    reasoningEffort: 'high',
    additionalDirectories: ['/extra'],
  });
  const log = mock.method(console, 'log', () => {});
  try {
    await controller.start({ dryRun: true });
  } finally {
    log.mock.restore();
  }
  const command = log.mock.calls.at(-1).arguments[0];
  assert.match(command, /--add-dir \/extra/);
  assert.match(command, /--effort high/);
});

test('getLaunchCapabilities reports each tool', () => {
  const capabilities = Object.fromEntries(
    Object.values(tools).map((tool) => [tool.name, getLaunchCapabilities(tool)])
  );
  assert.deepStrictEqual(capabilities.claude, {
    reasoningEffort: true,
    reasoningEfforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    maxOutputTokens: true,
    temperature: false,
    mcpConfig: true,
    strictMcpConfig: true,
    additionalDirectories: true,
    attachments: false,
    jsonSchema: true,
  });
  assert.strictEqual(capabilities.codex.strictMcpConfig, false);
  assert.strictEqual(capabilities.opencode.reasoningEfforts, null);
  assert.strictEqual(capabilities.codex.attachments, true);
  assert.strictEqual(capabilities.opencode.attachments, true);
  assert.deepStrictEqual(capabilities.agent, {
    reasoningEffort: false,
    reasoningEfforts: null,
    maxOutputTokens: false,
    temperature: true,
    mcpConfig: false,
    strictMcpConfig: false,
    additionalDirectories: false,
    attachments: false,
    jsonSchema: false,
  });
});

test('helpers validate their input', () => {
  assert.throws(() => normalizeReasoningEffort('high; rm'), /Invalid/);
  assert.throws(() => normalizeAdditionalDirectories(['']), /empty/);
  assert.deepStrictEqual(normalizeAdditionalDirectories('/a'), ['/a']);
  assert.throws(() => normalizeAttachments(['']), /attachments.*empty/);
  assert.deepStrictEqual(normalizeAttachments(undefined), []);
  assert.throws(() => mcpConfigArg(''), /empty/);
  assert.throws(() => mcpConfigArg(42), TypeError);
  assert.strictEqual(toTomlValue('a"b\n'), '"a\\"b\\n"');
  assert.strictEqual(toTomlValue({ 'a.b': [1, true] }), '{"a.b" = [1, true]}');
  assert.throws(() => toTomlValue(Infinity), /finite/);
  assert.throws(
    () => codexMcpServersOverride({ mcpServers: { a: 'x' } }),
    /must be an object/
  );
  assert.strictEqual(
    codexMcpServersOverride('{"mcpServers":{"a":{"command":"x"}}}'),
    'mcp_servers={a = {command = "x"}}'
  );
});

test('start-agent parses the launch option flags', () => {
  const parsed = parseStartAgentArgs([
    '--tool',
    'claude',
    '--reasoning-effort',
    'high',
    '--mcp-config',
    './mcp.json',
    '--strict-mcp-config',
    '--add-dir',
    '/a',
    '--add-dir',
    '/b',
    '--attach',
    'shot.png',
  ]);
  assert.strictEqual(parsed.reasoningEffort, 'high');
  assert.strictEqual(parsed.mcpConfig, './mcp.json');
  assert.strictEqual(parsed.strictMcpConfig, true);
  assert.deepStrictEqual(parsed.additionalDirectories, ['/a', '/b']);
  assert.deepStrictEqual(parsed.attachments, ['shot.png']);
});

test('agent() forwards attachments to codex', async () => {
  const controller = agent({
    tool: 'codex',
    workingDirectory: '/tmp',
    prompt: 'describe',
    attachments: ['shot.png'],
  });
  const log = mock.method(console, 'log', () => {});
  try {
    await controller.start({ dryRun: true });
  } finally {
    log.mock.restore();
  }
  assert.match(log.mock.calls.at(-1).arguments[0], /--image shot\.png/);
});
