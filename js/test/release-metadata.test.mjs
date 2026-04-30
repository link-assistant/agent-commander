/**
 * Tests for language-specific GitHub Release metadata.
 */

import { test } from 'node:test';
import assert from 'node:assert';
import {
  buildReleaseMetadata,
  normalizeReleaseVersion,
} from '../../scripts/shared/release-metadata.mjs';

test('buildReleaseMetadata - JavaScript release uses package prefix and badge', () => {
  const release = buildReleaseMetadata({
    language: 'javascript',
    version: '0.4.1',
    releaseNotes: 'Release notes',
  });

  assert.strictEqual(release.tagName, 'js_0.4.1');
  assert.strictEqual(release.name, '[JavaScript] v0.4.1');
  assert.match(release.body, /img\.shields\.io\/badge\/npm-v0\.4\.1-cb3837/);
  assert.match(
    release.body,
    /npmjs\.com\/package\/agent-commander\/v\/0\.4\.1/
  );
  assert.match(release.body, /Release notes/);
});

test('buildReleaseMetadata - Rust release uses package prefix and badge', () => {
  const release = buildReleaseMetadata({
    language: 'rust',
    version: '0.1.0',
    releaseNotes: 'Rust notes',
    cratesIoUrl: 'https://crates.io/crates/agent-commander',
  });

  assert.strictEqual(release.tagName, 'rust_0.1.0');
  assert.strictEqual(release.name, '[Rust] v0.1.0');
  assert.match(
    release.body,
    /img\.shields\.io\/badge\/crates\.io-v0\.1\.0-dea584/
  );
  assert.match(release.body, /crates\.io\/crates\/agent-commander\/0\.1\.0/);
  assert.match(release.body, /Rust notes/);
});

test('normalizeReleaseVersion strips existing language prefixes', () => {
  assert.strictEqual(normalizeReleaseVersion('js_1.2.3'), '1.2.3');
  assert.strictEqual(normalizeReleaseVersion('rust_1.2.3'), '1.2.3');
  assert.strictEqual(normalizeReleaseVersion('v1.2.3'), '1.2.3');
});
