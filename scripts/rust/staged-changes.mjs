/**
 * Report whether the index contains changes while preserving real git errors.
 *
 * `git diff --quiet` uses exit 1 as a normal "different" result. Command-stream
 * resolves that result, so callers must inspect the exit code explicitly.
 */
export async function hasStagedChanges($) {
  const result = await $`git diff --cached --quiet`.run({
    capture: true,
    mirror: false,
  });

  if (result.exitCode === 0) return false;
  if (result.exitCode === 1) return true;

  const detail = result.stderr?.trim();
  throw new Error(
    `git diff --cached --quiet failed with exit code ${result.exitCode}${
      detail ? `: ${detail}` : ""
    }`,
  );
}
