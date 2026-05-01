/**
 * Tests for Rust release registry/version-selection helpers.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  extractCratesVersions,
  isVersionPublished,
  maxPublishedVersion,
  parseCargoPackageInfo,
  selectRustReleaseVersion,
} from '../../scripts/rust/release-registry.mjs';

test('selectRustReleaseVersion skips stale GitHub release tags', () => {
  const selected = selectRustReleaseVersion({
    currentVersion: '0.1.0',
    bumpType: 'minor',
    publishedVersions: ['0.1.0'],
    existingTags: ['rust_0.2.0'],
  });

  assert.strictEqual(selected, '0.2.1');
});

test('selectRustReleaseVersion stays ahead of crates.io', () => {
  const selected = selectRustReleaseVersion({
    currentVersion: '0.1.0',
    bumpType: 'patch',
    publishedVersions: ['0.1.0', '0.2.0'],
    existingTags: [],
  });

  assert.strictEqual(selected, '0.2.1');
});

test('extractCratesVersions ignores yanked crate versions', () => {
  const versions = extractCratesVersions({
    versions: [
      { num: '0.3.0', yanked: true },
      { num: '0.2.0', yanked: false },
      { num: '0.1.0', yanked: false },
    ],
  });

  assert.deepStrictEqual(versions, ['0.2.0', '0.1.0']);
  assert.strictEqual(maxPublishedVersion(versions), '0.2.0');
});

test('isVersionPublished treats crates.io as release truth', () => {
  assert.strictEqual(isVersionPublished('0.1.0', ['0.1.0']), true);
  assert.strictEqual(isVersionPublished('0.2.0', ['0.1.0']), false);
});

test('parseCargoPackageInfo reads package name and version', () => {
  assert.deepStrictEqual(
    parseCargoPackageInfo(`
[package]
name = "agent-commander"
version = "0.1.0"
`),
    { name: 'agent-commander', version: '0.1.0' }
  );
});
