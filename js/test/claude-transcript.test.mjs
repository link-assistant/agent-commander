/**
 * Claude session transcripts: the usage-limit cross-check of a failed run
 * (hive-mind#3570; issue #55).
 */

import { test, before, after } from 'node:test';
import assert from 'node:assert';
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  agent,
  applyClaudeTranscriptUsageLimit,
  claudeProjectSlugs,
  claudeTranscriptApiError,
  claudeTranscriptCandidates,
  readClaudeTranscriptApiError,
} from '../src/index.mjs';

const SESSION = '5f0c2a7e-1b3d-4e5f-8a9b-0c1d2e3f4a5b';
const WORKDIR = '/tmp/work.dir/repo';
const LIMIT_TEXT = "You've hit your weekly limit · resets 11am (UTC)";

const user = (text) =>
  JSON.stringify({ type: 'user', message: { content: text } });
const apiError = (text) =>
  JSON.stringify({
    type: 'assistant',
    isApiErrorMessage: true,
    error: 'rate_limit',
    timestamp: '2026-10-21T00:00:00Z',
    message: { model: '<synthetic>', content: [{ type: 'text', text }] },
  });
const summary = JSON.stringify({ type: 'summary', summary: 'x' });

let configDir;

const writeTranscript = async (lines, workingDirectory = WORKDIR) => {
  const dir = join(
    configDir,
    'projects',
    claudeProjectSlugs(workingDirectory).at(-1)
  );
  await mkdir(dir, { recursive: true });
  const file = join(dir, `${SESSION}.jsonl`);
  await writeFile(file, `${lines.join('\n')}\n`);
  return file;
};

before(async () => {
  configDir = await mkdtemp(join(tmpdir(), 'agent-commander-claude-config-'));
});

after(async () => {
  await rm(configDir, { recursive: true, force: true });
});

test('claudeProjectSlugs covers the old and the new slug', () => {
  assert.deepStrictEqual(claudeProjectSlugs('/tmp/work.dir/repo'), [
    '-tmp-work.dir-repo',
    '-tmp-work-dir-repo',
  ]);
  assert.deepStrictEqual(claudeProjectSlugs('/tmp/repo'), ['-tmp-repo']);
});

test('claudeTranscriptCandidates searches CLAUDE_CONFIG_DIR, then ~/.claude', () => {
  assert.deepStrictEqual(
    claudeTranscriptCandidates({
      workingDirectory: '/w',
      sessionId: SESSION,
      claudeConfigDir: '/cfg',
      homeDir: '/home/u',
    }),
    [
      join('/cfg', 'projects', '-w', `${SESSION}.jsonl`),
      join('/home/u', '.claude', 'projects', '-w', `${SESSION}.jsonl`),
    ]
  );
  // Ids that are not session-shaped never become paths.
  assert.deepStrictEqual(
    claudeTranscriptCandidates({ workingDirectory: '/w', sessionId: '../x' }),
    []
  );
});

test('claudeTranscriptApiError reads only the last conversation entry', () => {
  const found = claudeTranscriptApiError(
    [user('hi'), apiError(LIMIT_TEXT), summary, 'not json'].join('\n')
  );
  assert.strictEqual(found.found, true);
  assert.strictEqual(found.text, LIMIT_TEXT);
  assert.strictEqual(found.error, 'rate_limit');

  const recovered = claudeTranscriptApiError(
    [apiError(LIMIT_TEXT), user('continue')].join('\n')
  );
  assert.strictEqual(recovered.found, false);
  assert.match(recovered.reason, /last entry is a user message/);
  assert.strictEqual(claudeTranscriptApiError('').found, false);
});

test('readClaudeTranscriptApiError finds the transcript under the new slug', async () => {
  const file = await writeTranscript([user('hi'), apiError(LIMIT_TEXT)]);
  const result = await readClaudeTranscriptApiError({
    workingDirectory: WORKDIR,
    sessionId: SESSION,
    claudeConfigDir: configDir,
    homeDir: configDir,
  });
  assert.strictEqual(result.found, true);
  assert.strictEqual(result.transcriptPath, file);
  const missing = await readClaudeTranscriptApiError({
    workingDirectory: '/nowhere',
    sessionId: SESSION,
    claudeConfigDir: configDir,
    homeDir: configDir,
  });
  assert.deepStrictEqual(missing, {
    found: false,
    reason: 'transcript not found',
  });
});

test('applyClaudeTranscriptUsageLimit only fills failed, unsignalled Claude runs', async () => {
  await writeTranscript([user('hi'), apiError(LIMIT_TEXT)]);
  const options = {
    workingDirectory: WORKDIR,
    claudeConfigDir: configDir,
    homeDir: configDir,
  };
  const base = {
    tool: 'claude',
    exitCode: 1,
    signal: null,
    success: false,
    limitReached: false,
    sessionId: SESSION,
  };
  const filled = await applyClaudeTranscriptUsageLimit({ ...base }, options);
  assert.strictEqual(filled.limitReached, true);
  assert.strictEqual(filled.limitSource, 'claude-transcript');
  assert.strictEqual(filled.limitResetTime, '11:00 AM');
  assert.strictEqual(filled.limitTimezone, 'UTC');

  for (const skipped of [
    { ...base, signal: 'SIGTERM' },
    { ...base, exitCode: 0, success: true },
    { ...base, tool: 'codex' },
    { ...base, sessionId: null },
  ]) {
    const result = await applyClaudeTranscriptUsageLimit(
      { ...skipped },
      options
    );
    assert.strictEqual(result.limitReached, false, JSON.stringify(skipped));
    assert.strictEqual(result.limitSource, undefined);
  }

  // An API error that is not a usage limit is left to the output.
  await writeTranscript([user('hi'), apiError('API Error: 500 overloaded')]);
  const other = await applyClaudeTranscriptUsageLimit({ ...base }, options);
  assert.strictEqual(other.limitReached, false);
});

test(
  'agent().stop() reports a usage limit found only in the Claude transcript',
  { skip: process.platform === 'win32', timeout: 15000 },
  async () => {
    const workingDirectory = await mkdtemp(
      join(tmpdir(), 'agent-commander-claude-work-')
    );
    await writeTranscript([user('hi'), apiError(LIMIT_TEXT)], workingDirectory);
    const binDir = await mkdtemp(
      join(tmpdir(), 'agent-commander-fake-claude-')
    );
    const originalPath = process.env.PATH;
    try {
      const script = join(binDir, 'claude');
      const init = { type: 'system', subtype: 'init', session_id: SESSION };
      await writeFile(
        script,
        `#!/usr/bin/env bash\necho '${JSON.stringify(init)}'\necho 'Claude command failed' >&2\nexit 1\n`
      );
      await chmod(script, 0o755);
      process.env.PATH = `${binDir}:${originalPath}`;
      const controller = agent({
        tool: 'claude',
        workingDirectory,
        prompt: 'hi',
        json: true,
        toolOptions: { extraEnv: { CLAUDE_CONFIG_DIR: configDir } },
      });
      await controller.start({ attached: false });
      const result = await controller
        .stop()
        .catch((error) => error.result ?? { error });
      const metadata = result.metadata ?? result.error?.metadata;
      assert.ok(metadata, String(result.error));
      assert.strictEqual(metadata.sessionId, SESSION);
      assert.strictEqual(metadata.success, false);
      assert.strictEqual(metadata.limitReached, true);
      assert.strictEqual(metadata.limitSource, 'claude-transcript');
    } finally {
      process.env.PATH = originalPath;
      await rm(binDir, { recursive: true, force: true });
      await rm(workingDirectory, { recursive: true, force: true });
    }
  }
);
