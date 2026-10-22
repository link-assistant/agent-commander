/**
 * Launch options shared by every tool: reasoning effort, MCP servers, extra
 * workspace directories, file attachments and a structured-output JSON Schema
 * (issue #57). Each tool maps them onto its own
 * native flag; a tool without a native flag rejects the option instead of
 * silently dropping it.
 */

const EFFORT_PATTERN = /^[A-Za-z0-9_-]+$/;
const TOML_BARE_KEY = /^[A-Za-z0-9_-]+$/;

/**
 * Validate a reasoning effort / variant name.
 * @param {string} reasoningEffort - Effort level
 * @returns {string} The effort level
 */
export function normalizeReasoningEffort(reasoningEffort) {
  const value = String(reasoningEffort);
  if (!EFFORT_PATTERN.test(value)) {
    throw new Error(
      `Invalid reasoning effort "${value}". Use a level name such as low, medium or high.`
    );
  }
  return value;
}

/**
 * Normalize a path list option: one path or an array of non-empty paths.
 * @param {string|string[]|undefined} value - Path or paths
 * @param {string} name - Option name for error messages
 * @returns {string[]} Paths
 */
function normalizePathList(value, name) {
  if (value === undefined || value === null) {
    return [];
  }
  return (Array.isArray(value) ? value : [value]).map((item) => {
    const path = String(item);
    if (!path) {
      throw new Error(`${name} entries must not be empty`);
    }
    return path;
  });
}

/**
 * Normalize the extra workspace directories.
 * @param {string|string[]|undefined} additionalDirectories - Directories
 * @returns {string[]} Directories
 */
export function normalizeAdditionalDirectories(additionalDirectories) {
  return normalizePathList(additionalDirectories, 'additionalDirectories');
}

/**
 * Normalize the files attached to the prompt (images for Codex, any file for
 * OpenCode). Relative paths resolve against the working directory.
 * @param {string|string[]|undefined} attachments - File paths
 * @returns {string[]} File paths
 */
export function normalizeAttachments(attachments) {
  return normalizePathList(attachments, 'attachments');
}

/**
 * Serialize the JSON Schema the final answer must match (Claude and Qwen
 * `--json-schema`, Codex `--output-schema`).
 * @param {string|Object} jsonSchema - Schema object or its JSON text
 * @returns {string} Compact JSON text
 */
export function jsonSchemaArg(jsonSchema) {
  let schema = jsonSchema;
  if (typeof schema === 'string') {
    try {
      schema = JSON.parse(schema);
    } catch (error) {
      throw new Error(`jsonSchema is not valid JSON: ${error.message}`, {
        cause: error,
      });
    }
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new TypeError(
      'jsonSchema must be a JSON Schema object or its JSON text'
    );
  }
  return JSON.stringify(schema);
}

/**
 * The `--mcp-config` value for tools that take a path or inline JSON
 * (Claude Code, Qwen Code). Objects are serialized to inline JSON.
 * @param {string|Object} mcpConfig - Path, inline JSON or `{mcpServers}` object
 * @returns {string} CLI value
 */
export function mcpConfigArg(mcpConfig) {
  if (typeof mcpConfig === 'string') {
    if (!mcpConfig) {
      throw new Error('mcpConfig must not be empty');
    }
    return mcpConfig;
  }
  if (mcpConfig && typeof mcpConfig === 'object' && !Array.isArray(mcpConfig)) {
    return JSON.stringify(mcpConfig);
  }
  throw new TypeError(
    'mcpConfig must be a file path, an inline JSON string or a {mcpServers} object'
  );
}

/**
 * Read the `mcpServers` map from an object or inline JSON string.
 * @param {string|Object} mcpConfig - MCP configuration
 * @param {string} tool - Tool name for error messages
 * @returns {Object} Server name → server definition
 */
export function mcpServersFromConfig(mcpConfig, tool) {
  let config = mcpConfig;
  if (typeof config === 'string') {
    if (!config.trim().startsWith('{')) {
      throw new Error(
        `Tool "${tool}" takes MCP servers as config overrides, not a file path. Pass mcpConfig as a {mcpServers} object or inline JSON.`
      );
    }
    config = JSON.parse(config);
  }
  const servers = config?.mcpServers;
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('mcpConfig must contain an mcpServers object');
  }
  return servers;
}

/**
 * Encode a TOML key segment.
 * @param {string} key - Key
 * @returns {string} Bare or quoted key
 */
function tomlKey(key) {
  return TOML_BARE_KEY.test(key) ? key : JSON.stringify(key);
}

/**
 * Encode a JSON value as an inline TOML value. JSON string escapes are a
 * subset of TOML basic-string escapes, so strings reuse JSON.stringify.
 * @param {*} value - JSON value
 * @returns {string} TOML value
 */
export function toTomlValue(value) {
  if (typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new Error('TOML values must be finite numbers');
    }
    return String(value);
  }
  if (typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(toTomlValue).join(', ')}]`;
  }
  if (value && typeof value === 'object') {
    const fields = Object.entries(value)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => `${tomlKey(key)} = ${toTomlValue(item)}`);
    return `{${fields.join(', ')}}`;
  }
  throw new Error(`Cannot encode ${value} as a TOML value`);
}

/**
 * Translate a Claude-style `{mcpServers}` map into one Codex `-c` override.
 * `headers` becomes Codex's `http_headers`; the transport `type` is implied
 * by `command` (stdio) or `url` (streamable HTTP) and is dropped. Codex
 * merges the table into the servers from config.toml (checked with codex
 * 0.163 `mcp list --json`), and a quoted name only works inside the table:
 * the dotted `-c` key path keeps the quotes as part of the name.
 * @param {string|Object} mcpConfig - MCP configuration
 * @returns {string} `mcp_servers={...}` override value
 */
export function codexMcpServersOverride(mcpConfig) {
  const servers = mcpServersFromConfig(mcpConfig, 'codex');
  const table = {};
  for (const [name, server] of Object.entries(servers)) {
    if (!server || typeof server !== 'object' || Array.isArray(server)) {
      throw new Error(`MCP server "${name}" must be an object`);
    }
    const { type: _type, headers, ...rest } = server;
    table[name] = headers ? { ...rest, http_headers: headers } : rest;
  }
  return `mcp_servers=${toTomlValue(table)}`;
}

/**
 * Describe what a tool natively supports among the launch options.
 * @param {Object} toolConfig - Tool configuration
 * @returns {{reasoningEffort: boolean, reasoningEfforts: string[]|null, mcpConfig: boolean, strictMcpConfig: boolean, additionalDirectories: boolean, attachments: boolean, jsonSchema: boolean}}
 */
export function getLaunchCapabilities(toolConfig) {
  return {
    reasoningEffort: Boolean(toolConfig?.supportsReasoningEffort),
    reasoningEfforts: toolConfig?.reasoningEfforts || null,
    mcpConfig: Boolean(toolConfig?.supportsMcpConfig),
    strictMcpConfig: Boolean(toolConfig?.supportsStrictMcpConfig),
    additionalDirectories: Boolean(toolConfig?.supportsAdditionalDirectories),
    attachments: Boolean(toolConfig?.supportsAttachments),
    jsonSchema: Boolean(toolConfig?.supportsJsonSchema),
  };
}

const LAUNCH_OPTIONS = [
  {
    key: 'reasoningEffort',
    flag: 'supportsReasoningEffort',
    label: 'reasoning effort (--reasoning-effort)',
  },
  {
    key: 'mcpConfig',
    flag: 'supportsMcpConfig',
    label: 'MCP server configuration (--mcp-config)',
  },
  {
    key: 'strictMcpConfig',
    flag: 'supportsStrictMcpConfig',
    label: 'strict MCP configuration (--strict-mcp-config)',
  },
  {
    key: 'additionalDirectories',
    flag: 'supportsAdditionalDirectories',
    label: 'additional directories (--add-dir)',
    normalize: normalizeAdditionalDirectories,
  },
  {
    key: 'attachments',
    flag: 'supportsAttachments',
    label: 'file attachments (--attach)',
    normalize: normalizeAttachments,
  },
  {
    key: 'jsonSchema',
    flag: 'supportsJsonSchema',
    label: 'structured output (--json-schema)',
  },
];

/**
 * List the tools that support a launch option.
 * @param {Object} tools - Tool configurations by name
 * @param {string} flag - Capability flag
 * @returns {string} Comma-separated tool names
 */
function supportingTools(tools, flag) {
  return Object.values(tools)
    .filter((tool) => tool[flag])
    .map((tool) => tool.name)
    .join(', ');
}

/**
 * Throw when a requested launch option has no native flag in the tool.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {Object|undefined} options.toolConfig - Tool configuration
 * @param {Object} options.tools - All tool configurations
 * @param {Object} options.requested - Requested launch options
 */
export function assertLaunchOptionsSupported({
  tool,
  toolConfig,
  tools,
  requested,
}) {
  for (const { key, flag, label, normalize } of LAUNCH_OPTIONS) {
    const value = requested[key];
    const isRequested = normalize
      ? normalize(value).length > 0
      : value !== undefined && value !== null && value !== false;
    if (isRequested && !toolConfig?.[flag]) {
      throw new Error(
        `Tool "${tool}" does not support ${label}. Choose one of: ${supportingTools(tools, flag)}; or omit the option.`
      );
    }
  }
}

/**
 * Keep only the launch options a caller actually set, so they do not
 * override the same keys passed through `toolOptions` with `undefined`.
 * @param {Object} options - Launch options
 * @returns {Object} Options without undefined, null or false values
 */
export function definedLaunchOptions(options) {
  return Object.fromEntries(
    Object.entries(options).filter(
      ([, value]) => value !== undefined && value !== null && value !== false
    )
  );
}
