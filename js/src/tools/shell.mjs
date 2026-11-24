/**
 * Shared shell helpers for tool command builders.
 */

import { quoteForContext } from 'command-stream';

const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Escape an argument for shell usage.
 * @param {string} arg - Argument to escape
 * @returns {string} Escaped argument
 */
export function escapeArg(arg) {
  const value = String(arg);
  if (!/^[-a-zA-Z0-9_./:=+,@%]+$/.test(value)) {
    return `"${quoteForContext(value, 'double')}"`;
  }
  return value;
}

/**
 * Escape a value for printing inside '...' (command-stream's single-quote
 * context).
 * @param {string} value - Value to escape
 * @returns {string} Escaped value without surrounding quotes
 */
export function escapeSingleQuotes(value) {
  return quoteForContext(value ?? '', 'single');
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
 * A `null` or `undefined` value removes the variable from the inherited
 * environment (Hive Mind drops `GH_TOKEN`, `MAX_THINKING_TOKENS`, ... per run).
 * @param {Object|Array|undefined} extraEnv - Environment variables
 * @returns {Array<[string, string|null]>} Normalized entries; `null` unsets
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
    return [name, value === null || value === undefined ? null : String(value)];
  });
}

/**
 * Render `<flag> "$(cat <file>)"`: the shell reads the value from a private
 * temporary file at run time, so it never appears in the `bash -c` command
 * line (issue #60). The value still becomes one argv entry of the tool, so the
 * per-argument limit (`MAX_ARG_STRLEN`, 128 KiB on Linux) applies.
 * @param {string} flag - CLI flag such as `--json-schema`
 * @param {string} file - File holding the value
 * @returns {string} Shell fragment with a leading space
 */
export function fileContentArg(flag, file) {
  return ` ${flag} "$(cat ${escapeArg(file)})"`;
}

/**
 * Normalize the `inheritEnv` option.
 * @param {boolean|string[]|undefined} inheritEnv - `true` (default) inherits
 *   the whole parent environment, `false` nothing, an array only those names
 * @returns {true|false|string[]} Normalized value
 */
export function normalizeInheritEnv(inheritEnv = true) {
  if (inheritEnv === true || inheritEnv === false) {
    return inheritEnv;
  }
  if (Array.isArray(inheritEnv)) {
    return inheritEnv.map((name) => {
      const value = String(name);
      if (!ENV_NAME_PATTERN.test(value)) {
        throw new Error(`Invalid environment variable name "${value}"`);
      }
      return value;
    });
  }
  throw new TypeError(
    'inheritEnv must be true, false or an array of variable names'
  );
}

/**
 * Build the environment of the tool's child process. Values travel in the
 * `spawn` `env` option, never on the command line, so they do not show up in
 * `/proc/<pid>/cmdline` or `ps` (issue #60).
 *
 * 1. Start from `env` when given (an explicit replacement map); otherwise from
 *    the parent environment filtered by `inheritEnv` (`true` = everything,
 *    `false` = nothing, `string[]` = an allowlist).
 * 2. Apply `extraEnv`: a value sets the variable, `null` removes it.
 * @param {Object} [options] - Options
 * @param {Object|Array} [options.extraEnv] - Variables to add or remove
 * @param {Object} [options.env] - Explicit base environment (replaces inheritance)
 * @param {boolean|string[]} [options.inheritEnv=true] - What to inherit
 * @param {Object} [options.parentEnv=process.env] - Parent environment
 * @returns {Object} Environment for `spawn`
 */
export function buildChildEnvironment(options = {}) {
  const {
    extraEnv,
    env,
    inheritEnv,
    parentEnv = typeof process !== 'undefined' ? process.env : {},
  } = options;
  const inherit = normalizeInheritEnv(inheritEnv);
  let base;
  if (env !== undefined && env !== null) {
    if (typeof env !== 'object' || Array.isArray(env)) {
      throw new TypeError('env must be an object of NAME: value pairs');
    }
    base = Object.entries(env);
  } else if (inherit === true) {
    base = Object.entries(parentEnv);
  } else if (inherit === false) {
    base = [];
  } else {
    base = inherit
      .filter((name) => parentEnv[name] !== undefined)
      .map((name) => [name, parentEnv[name]]);
  }
  const result = {};
  for (const [name, value] of base) {
    if (value !== undefined && value !== null) {
      result[name] = String(value);
    }
  }
  for (const [name, value] of normalizeExtraEnv(extraEnv)) {
    if (value === null) {
      delete result[name];
    } else {
      result[name] = value;
    }
  }
  return result;
}

/**
 * Build a command head with the executable and its prefix args.
 *
 * Caller `extraEnv` is deliberately *not* rendered: its values are passed to
 * the child through the `spawn` environment (see
 * {@link buildChildEnvironment}) so secrets never reach argv. Only `fixedEnv`
 * — library-owned constants such as the OpenCode read-only policy — is
 * rendered as an `env NAME=value` prefix.
 * @param {Object} options - Options
 * @param {string} options.executable - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Ignored here; see above
 * @param {Object|Array} [options.fixedEnv] - Non-secret variables to render
 * @param {string[]} [options.prefixArgs] - Arguments placed before subcommands
 * @returns {string} Command head
 */
export function buildCommandHead(options) {
  const { executable, fixedEnv, prefixArgs = [] } = options;
  const envEntries = normalizeExtraEnv(fixedEnv).filter(
    ([, value]) => value !== null
  );
  const parts = [];

  if (envEntries.length > 0) {
    parts.push(
      'env',
      ...envEntries.map(([key, value]) => `${key}=${escapeArg(value)}`)
    );
  }

  parts.push(escapeArg(executable));
  parts.push(...normalizeExtraArgs(prefixArgs).map(escapeArg));
  return parts.join(' ');
}
