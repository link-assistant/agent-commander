/**
 * Tests for the tool version probe (issue #57).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import {
  buildVersionCommand,
  compareVersions,
  getToolVersion,
  parseToolVersion,
  toolVersionFromOutput,
} from '../src/index.mjs';

const fixture = (tool) =>
  readFileSync(
    new URL(
      `../../docs/case-studies/issue-57/data/cli-help/${tool}.version`,
      import.meta.url
    ),
    'utf8'
  );

test('parseToolVersion reads the real --version output of every tool', () => {
  assert.deepStrictEqual(
    Object.fromEntries(
      ['agent', 'claude', 'codex', 'gemini', 'opencode', 'qwen'].map((tool) => [
        tool,
        parseToolVersion(fixture(tool)),
      ])
    ),
    {
      agent: '0.26.15',
      claude: '2.1.308',
      codex: '0.163.0',
      gemini: '0.64.0',
      opencode: '1.19.3',
      qwen: '0.25.2',
    }
  );
  assert.strictEqual(parseToolVersion('v1.2.3-beta.1\n'), '1.2.3-beta.1');
  assert.strictEqual(parseToolVersion('command not found'), null);
  assert.strictEqual(parseToolVersion(undefined), null);
});

test('compareVersions orders numerically with prereleases first', () => {
  assert.strictEqual(compareVersions('2.1.308', '2.1.99'), 1);
  assert.strictEqual(compareVersions('0.163.0', '0.163.0'), 0);
  assert.strictEqual(compareVersions('1.2', '1.2.0'), 0);
  assert.strictEqual(compareVersions('v1.0.0', '1.0.1'), -1);
  assert.strictEqual(compareVersions('1.0.0-rc.1', '1.0.0'), -1);
  assert.strictEqual(compareVersions('1.0.0-beta', '1.0.0-alpha'), 1);
  assert.throws(() => compareVersions('latest', '1.0.0'), /Invalid version/);
});

test('buildVersionCommand uses the tool executable or an override', () => {
  assert.strictEqual(
    buildVersionCommand({ tool: 'claude' }),
    'claude --version 2>&1'
  );
  assert.strictEqual(
    buildVersionCommand({ tool: 'codex', executable: '/opt/my codex' }),
    '"/opt/my codex" --version 2>&1'
  );
  assert.throws(() => buildVersionCommand({ tool: 'nope' }), /Unknown tool/);
});

test('toolVersionFromOutput separates missing, broken and outdated tools', () => {
  assert.deepStrictEqual(
    toolVersionFromOutput({
      tool: 'codex',
      exitCode: 0,
      output: 'codex-cli 0.163.0\n',
      minimumVersion: '0.160.0',
    }),
    {
      tool: 'codex',
      installed: true,
      version: '0.163.0',
      raw: 'codex-cli 0.163.0',
      meetsMinimum: true,
    }
  );
  const missing = toolVersionFromOutput({
    tool: 'qwen',
    exitCode: 127,
    output: 'bash: line 1: qwen: command not found',
    minimumVersion: '0.1.0',
  });
  assert.strictEqual(missing.installed, false);
  assert.strictEqual(missing.version, null);
  assert.strictEqual(missing.meetsMinimum, false);
  const broken = toolVersionFromOutput({ tool: 'gemini', exitCode: 1 });
  assert.strictEqual(broken.installed, true);
  assert.strictEqual(broken.version, null);
  assert.strictEqual(broken.meetsMinimum, null);
  assert.strictEqual(
    toolVersionFromOutput({
      tool: 'claude',
      exitCode: 0,
      output: '2.0.1 (Claude Code)',
      minimumVersion: '2.1.0',
    }).meetsMinimum,
    false
  );
});

test('getToolVersion runs the probe through the executor', async () => {
  const calls = [];
  const result = await getToolVersion({
    tool: 'claude',
    minimumVersion: '2.1.0',
    execute: async (command, options) => {
      calls.push({ command, options });
      return { exitCode: 0, stdout: fixture('claude') };
    },
  });
  assert.deepStrictEqual(calls, [
    { command: 'claude --version 2>&1', options: { attached: false } },
  ]);
  assert.strictEqual(result.version, '2.1.308');
  assert.strictEqual(result.meetsMinimum, true);
});

test('getToolVersion reports a missing executable', async () => {
  const result = await getToolVersion({
    tool: 'codex',
    executable: '/nonexistent/agent-commander-codex',
  });
  assert.strictEqual(result.installed, false);
  assert.strictEqual(result.version, null);
});
