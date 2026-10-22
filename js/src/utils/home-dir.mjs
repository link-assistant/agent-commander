import os from 'node:os';

/**
 * The user's home directory, or `null` when it cannot be read. Deno denies
 * `os.homedir()` without `--allow-sys=homedir`, so `HOME` / `USERPROFILE`
 * are tried next.
 * @returns {string|null}
 */
export function userHomeDir() {
  try {
    const home = os.homedir();
    if (home) {
      return home;
    }
  } catch {
    // Fall through to the environment.
  }
  return process.env.HOME || process.env.USERPROFILE || null;
}
