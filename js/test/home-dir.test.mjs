/**
 * The home directory lookup used by the session-file checks (issue #55).
 */

import { test } from 'node:test';
import assert from 'node:assert';
import { userHomeDir } from '../src/utils/home-dir.mjs';

test('userHomeDir returns a directory or null, and never throws', () => {
  // Under `deno test` without --allow-sys=homedir this goes through the
  // HOME / USERPROFILE fallback.
  const home = userHomeDir();
  assert.ok(home === null || (typeof home === 'string' && home.length > 0));
});
