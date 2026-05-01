/**
 * Shared shell helpers for tool command builders.
 */

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Escape an argument for shell usage.
 * @param {string} arg - Argument to escape
 * @returns {string} Escaped argument
 */
export function escapeArg(arg) {
  const value = String(arg);
  if (/["\s$`\\]/.test(value)) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
  }
  return value;
}

/**
 * Normalize passthrough CLI args.
 * @param {string[]|undefined} extraArgs - Extra arguments
 * @returns {string[]} Normalized arguments
 */
export function normalizeExtraArgs(extraArgs = []) {
  if (!Array.isArray(extraArgs)) {
    throw new TypeError('extraArgs must be an array');
  }
  return extraArgs.map((arg) => String(arg));
}

/**
 * Normalize passthrough environment variables.
 * @param {Object|Array|undefined} extraEnv - Environment variables
 * @returns {Array<[string, string]>} Normalized entries
 */
export function normalizeExtraEnv(extraEnv = {}) {
  const entries = [];

  if (Array.isArray(extraEnv)) {
    for (const entry of extraEnv) {
      if (typeof entry === 'string') {
        const separatorIndex = entry.indexOf('=');
        if (separatorIndex === -1) {
          throw new Error(
            `Invalid environment entry "${entry}". Use KEY=VALUE.`
          );
        }
        entries.push([
          entry.slice(0, separatorIndex),
          entry.slice(separatorIndex + 1),
        ]);
      } else if (Array.isArray(entry) && entry.length === 2) {
        entries.push([entry[0], entry[1]]);
      } else {
        throw new Error(
          'extraEnv entries must be KEY=VALUE strings or [key, value] pairs'
        );
      }
    }
  } else if (extraEnv && typeof extraEnv === 'object') {
    entries.push(...Object.entries(extraEnv));
  } else if (extraEnv !== undefined && extraEnv !== null) {
    throw new TypeError('extraEnv must be an object or array');
  }

  return entries.map(([key, value]) => {
    const name = String(key);
    if (!ENV_NAME_PATTERN.test(name)) {
      throw new Error(`Invalid environment variable name "${name}"`);
    }
    return [name, String(value)];
  });
}

/**
 * Build a command head with optional env vars and executable prefix args.
 * @param {Object} options - Options
 * @param {string} options.executable - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Environment variables
 * @param {string[]} [options.prefixArgs] - Arguments placed before subcommands
 * @returns {string} Command head
 */
export function buildCommandHead(options) {
  const { executable, extraEnv, prefixArgs = [] } = options;
  const envEntries = normalizeExtraEnv(extraEnv);
  const parts = [];

  if (envEntries.length > 0) {
    parts.push('env');
    parts.push(
      ...envEntries.map(([key, value]) => `${key}=${escapeArg(value)}`)
    );
  }

  parts.push(escapeArg(executable));
  parts.push(...normalizeExtraArgs(prefixArgs).map(escapeArg));
  return parts.join(' ');
}
