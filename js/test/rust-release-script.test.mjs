import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasStagedChanges } from '../../scripts/rust/staged-changes.mjs';

function commandStreamResult(exitCode, stderr = '') {
  return () => ({
    run: async () => ({ exitCode, stderr }),
  });
}

test('Rust release recognizes git diff exit 1 as staged changes', async () => {
  assert.equal(await hasStagedChanges(commandStreamResult(1)), true);
});

test('Rust release recognizes git diff exit 0 as a clean index', async () => {
  assert.equal(await hasStagedChanges(commandStreamResult(0)), false);
});

test('Rust release preserves unexpected git failures', async () => {
  await assert.rejects(
    hasStagedChanges(commandStreamResult(128, 'fatal: corrupt index')),
    /exit code 128: fatal: corrupt index/u
  );
});
