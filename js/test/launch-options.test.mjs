/**
 * Tests for the shared launch options (issue #57): reasoning effort, MCP
 * servers, strict MCP configuration, extra workspace directories and file
 * attachments.
 */

import { mock, test } from 'node:test';
import assert from 'node:assert';
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
    mcpConfig: true,
    strictMcpConfig: true,
    additionalDirectories: true,
    attachments: false,
  });
  assert.strictEqual(capabilities.codex.strictMcpConfig, false);
  assert.strictEqual(capabilities.opencode.reasoningEfforts, null);
  assert.strictEqual(capabilities.codex.attachments, true);
  assert.strictEqual(capabilities.opencode.attachments, true);
  assert.deepStrictEqual(capabilities.agent, {
    reasoningEffort: false,
    reasoningEfforts: null,
    mcpConfig: false,
    strictMcpConfig: false,
    additionalDirectories: false,
    attachments: false,
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
