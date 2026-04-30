/**
 * Tests for the root package manifest used by GitHub dependency installs.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'node:fs/promises';
import { URL } from 'node:url';

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}

test('root package manifest exposes the JavaScript package for GitHub installs', async () => {
  const rootPackage = await readJson(
    new URL('../../package.json', import.meta.url)
  );
  const jsPackage = await readJson(new URL('../package.json', import.meta.url));

  assert.strictEqual(rootPackage.name, jsPackage.name);
  assert.strictEqual(rootPackage.version, jsPackage.version);
  assert.strictEqual(rootPackage.type, jsPackage.type);
  assert.strictEqual(rootPackage.license, jsPackage.license);
  assert.deepStrictEqual(rootPackage.engines, jsPackage.engines);

  assert.strictEqual(rootPackage.main, './js/src/index.mjs');
  assert.deepStrictEqual(rootPackage.exports, {
    '.': './js/src/index.mjs',
  });
  assert.deepStrictEqual(rootPackage.bin, {
    'start-agent': './js/bin/start-agent.mjs',
    'stop-agent': './js/bin/stop-agent.mjs',
  });

  assert.ok(rootPackage.files.includes('js/src'));
  assert.ok(rootPackage.files.includes('js/bin'));
});
