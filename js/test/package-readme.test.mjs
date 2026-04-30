/**
 * Tests for package README metadata.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('JavaScript package ships its own README', async () => {
  const packageJson = await readJson(
    new URL('../package.json', import.meta.url)
  );
  const readme = await readFile(
    new URL('../README.md', import.meta.url),
    'utf8'
  );

  assert.ok(packageJson.files.includes('README.md'));
  assert.match(readme, /^# agent-commander/m);
  assert.match(readme, /npm install agent-commander/);
  assert.match(readme, /start-agent --tool claude/);
});
