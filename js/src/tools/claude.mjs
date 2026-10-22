import { nativeUsage } from './usage.mjs';
/**
 * Claude CLI tool configuration
 * Based on hive-mind's claude.lib.mjs implementation
 */

import { syncedModels, syncedDefaults } from './model-catalog.mjs';
import { createModelMapper, parseJsonLines } from './json-lines.mjs';

import { buildCommandHead, escapeArg, normalizeExtraArgs } from './shell.mjs';
import {
  mcpConfigArg,
  normalizeAdditionalDirectories,
  normalizeReasoningEffort,
} from './launch-options.mjs';

/**
 * Levels accepted by `claude --effort` (Claude Code 2.1.x).
 */
export const reasoningEfforts = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * Available Claude model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  ...syncedModels.claude,
};

/**
 * Rolling Claude Code aliases. Claude Code resolves them itself, so a direct
 * run keeps them and follows the vendor's newest model (hive-mind#2290).
 */
export const ROLLING_CLAUDE_ALIASES = new Set(['opus', 'sonnet', 'haiku']);

const CLAUDE_FAMILIES = new Set(
  Object.values(modelMap)
    .map((id) => /^claude-([a-z]+)-\d/.exec(id)?.[1])
    .filter(Boolean)
);

/**
 * Expand a version shorthand for a known Claude family, so a release newer
 * than this build reaches Claude Code under its canonical ID
 * (hive-mind#2591): `opus-6` / `opus-6.1` / `claude-opus-6.1` →
 * `claude-opus-6` / `claude-opus-6-1`.
 * @param {string} model - Model alias
 * @returns {string|null} Canonical model ID
 */
export function expandClaudeVersionShorthand(model) {
  const match =
    typeof model === 'string'
      ? /^(?:claude-)?([a-z]+)-(\d+)(?:[.-](\d+))?$/.exec(model.toLowerCase())
      : null;
  if (!match || !CLAUDE_FAMILIES.has(match[1])) {
    return null;
  }
  return `claude-${match[1]}-${match[2]}${match[3] === undefined ? '' : `-${match[3]}`}`;
}

const mapBaseModelToId = createModelMapper(
  modelMap,
  expandClaudeVersionShorthand
);

/**
 * Map model alias to full model ID
 * Aliases match case-insensitively; a `[1m]` context suffix is kept.
 * @param {Object} options - Options
 * @param {string} options.model - Model alias or full ID
 * @returns {string} Full model ID
 */
export function mapModelToId({ model }) {
  const match = typeof model === 'string' ? /^(.+?)\[1m\]$/i.exec(model) : null;
  return match
    ? `${mapBaseModelToId({ model: match[1] })}[1m]`
    : mapBaseModelToId({ model });
}

/**
 * Model value for `--model` / `--fallback-model`: rolling aliases stay
 * (lower-cased, `[1m]` kept), everything else maps to its full ID.
 * @param {Object} options - Options
 * @param {string} options.model - Model alias or full ID
 * @returns {string} CLI model value
 */
export function modelArg({ model }) {
  if (typeof model !== 'string') {
    return model;
  }
  const match = /^(.+?)(\[1m\])?$/i.exec(model);
  const base = match[1].toLowerCase();
  return ROLLING_CLAUDE_ALIASES.has(base)
    ? `${base}${match[2] ? '[1m]' : ''}`
    : mapModelToId({ model });
}

/**
 * Build command line arguments for Claude
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.appendSystemPrompt] - System prompt to append to default
 * @param {string} [options.model] - Model to use
 * @param {string} [options.fallbackModel] - Fallback model when default is overloaded
 * @param {boolean} [options.print] - Print mode (non-interactive)
 * @param {boolean} [options.verbose] - Verbose mode
 * @param {boolean} [options.json] - JSON output mode (stream-json format)
 * @param {boolean} [options.jsonInput] - JSON input mode (stream-json format)
 * @param {boolean} [options.replayUserMessages] - Re-emit user messages on stdout
 * @param {string} [options.resume] - Resume session ID
 * @param {string} [options.sessionId] - Use specific session ID (must be valid UUID)
 * @param {boolean} [options.forkSession] - Create new session ID when resuming
 * @param {boolean} [options.readOnly] - Use Claude plan permission mode
 * @param {boolean} [options.approveEach] - Approve each command (`--permission-mode default`)
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {boolean} [options.skipDefaultSafetyFlags] - Do not add default bypass flags
 * @param {string} [options.permissionMode] - Explicit Claude permission mode
 * @param {string} [options.reasoningEffort] - Effort level (`--effort`)
 * @param {string|Object} [options.mcpConfig] - MCP config path, inline JSON or object (`--mcp-config`)
 * @param {boolean} [options.strictMcpConfig] - Use only `mcpConfig` servers (`--strict-mcp-config`)
 * @param {string[]} [options.additionalDirectories] - Extra directories (`--add-dir`)
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    prompt,
    systemPrompt,
    appendSystemPrompt,
    model,
    fallbackModel,
    print = false,
    verbose = false,
    json = false,
    jsonInput = false,
    replayUserMessages = false,
    resume,
    sessionId,
    forkSession = false,
    readOnly = false,
    approveEach = false,
    extraArgs = [],
    skipDefaultSafetyFlags = false,
    permissionMode,
    reasoningEffort,
    mcpConfig,
    strictMcpConfig = false,
    additionalDirectories,
  } = options;

  const args = [];

  if (approveEach) {
    // Per-command approval: ask before each tool use via the stream-json
    // can_use_tool control protocol. `default` keeps Claude's own prompting
    // active instead of bypassing it; the relay answers each request.
    args.push('--permission-mode', 'default');
  } else if (readOnly) {
    args.push('--permission-mode', 'plan');
  } else if (permissionMode) {
    args.push('--permission-mode', permissionMode);
  } else if (!skipDefaultSafetyFlags) {
    // Permission bypass - enabled by default for autonomous execution
    args.push('--dangerously-skip-permissions');
  }

  // Variadic flags (`--add-dir`, `--mcp-config`) come before the typed flags
  // so a following option always ends their value list.
  for (const dir of normalizeAdditionalDirectories(additionalDirectories)) {
    args.push('--add-dir', dir);
  }

  if (mcpConfig !== undefined && mcpConfig !== null) {
    args.push('--mcp-config', mcpConfigArg(mcpConfig));
  }

  if (strictMcpConfig) {
    args.push('--strict-mcp-config');
  }

  if (reasoningEffort) {
    args.push('--effort', normalizeReasoningEffort(reasoningEffort));
  }

  if (model) {
    args.push('--model', modelArg({ model }));
  }

  if (fallbackModel) {
    args.push('--fallback-model', modelArg({ model: fallbackModel }));
  }

  if (prompt) {
    args.push('-p', prompt);
  }

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }

  if (verbose || json) {
    args.push('--verbose');
  }

  if (!prompt && (print || json || jsonInput)) {
    args.push('-p'); // Print mode
  }

  // JSON output mode - use stream-json format per issue #3
  if (json) {
    args.push('--output-format', 'stream-json');
  }

  // JSON input mode - use stream-json format per issue #3
  if (jsonInput) {
    args.push('--input-format', 'stream-json');
  }

  // Replay user messages (only with stream-json input/output)
  if (replayUserMessages) {
    args.push('--replay-user-messages');
  }

  // Session management
  if (sessionId) {
    args.push('--session-id', sessionId);
  }

  if (resume) {
    args.push('--resume', resume);
  }

  if (forkSession) {
    args.push('--fork-session');
  }

  args.push(...normalizeExtraArgs(extraArgs));

  return args;
}

/**
 * Build complete command string for Claude
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.promptFile] - File containing prompt input
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.appendSystemPrompt] - System prompt to append to default
 * @param {string} [options.model] - Model to use
 * @param {string} [options.fallbackModel] - Fallback model when default is overloaded
 * @param {boolean} [options.print] - Print mode (non-interactive)
 * @param {boolean} [options.verbose] - Verbose mode
 * @param {boolean} [options.json] - JSON output mode (stream-json format)
 * @param {boolean} [options.jsonInput] - JSON input mode (stream-json format)
 * @param {boolean} [options.replayUserMessages] - Re-emit user messages on stdout
 * @param {string} [options.resume] - Resume session ID
 * @param {string} [options.sessionId] - Use specific session ID (must be valid UUID)
 * @param {boolean} [options.forkSession] - Create new session ID when resuming
 * @param {boolean} [options.readOnly] - Use Claude plan permission mode
 * @param {boolean} [options.approveEach] - Approve each command (`--permission-mode default`)
 * @param {string} [options.executable='claude'] - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Environment variables for the tool
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {boolean} [options.skipDefaultSafetyFlags] - Do not add default bypass flags
 * @param {string} [options.permissionMode] - Explicit Claude permission mode
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  const {
    prompt,
    promptFile,
    executable = 'claude',
    extraEnv,
    streamInput = false,
    ...argOptions
  } = options;
  const args = buildArgs({
    ...argOptions,
    print: argOptions.print || Boolean(promptFile || prompt),
    // In stream-input mode the prompt is written to stdin as NDJSON frames by
    // the per-command approval relay, so it is not passed as a --prompt arg.
    prompt: promptFile || streamInput ? undefined : prompt,
  });
  const command =
    `${buildCommandHead({ executable, extraEnv })} ${args.map(escapeArg).join(' ')}`.trim();

  if (streamInput) {
    return command;
  }

  if (promptFile) {
    return `cat ${escapeArg(promptFile)} | ${command}`;
  }

  return command;
}

/**
 * Parse JSON messages from Claude output
 * Claude outputs NDJSON (newline-delimited JSON) in JSON mode
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object[]} Array of parsed JSON messages
 */
export function parseOutput(options) {
  return parseJsonLines(options);
}

/**
 * Extract session ID from Claude output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {string|null} Session ID or null
 */
export function extractSessionId(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  for (const msg of messages) {
    if (msg.session_id) {
      return msg.session_id;
    }
  }

  return null;
}

/**
 * Extract usage statistics from Claude output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Usage statistics
 */
export function extractUsage({ output }) {
  return nativeUsage('claude', parseOutput({ output }));
}

/**
 * Claude tool configuration
 */
export const claudeTool = {
  name: 'claude',
  displayName: 'Claude Code CLI',
  executable: 'claude',
  supportsJsonOutput: true,
  supportsJsonInput: true, // Claude supports stream-json input format
  supportsSystemPrompt: true,
  supportsAppendSystemPrompt: true, // Supports --append-system-prompt
  supportsResume: true,
  supportsForkSession: true, // Supports --fork-session
  supportsSessionId: true, // Supports --session-id
  supportsFallbackModel: true, // Supports --fallback-model
  supportsVerbose: true, // Supports --verbose
  supportsReplayUserMessages: true, // Supports --replay-user-messages
  supportsReadOnly: true, // Supports --permission-mode plan
  supportsAsk: true, // Per-command approval via stream-json can_use_tool relay
  supportsReasoningEffort: true, // --effort <level>
  reasoningEfforts,
  supportsMcpConfig: true, // --mcp-config <path|json>
  supportsStrictMcpConfig: true, // --strict-mcp-config
  supportsAdditionalDirectories: true, // --add-dir <dir>
  supportsAttachments: false, // Images go through liveInput content blocks
  defaultModel: syncedDefaults.claude,
  modelMap,
  mapModelToId,
  modelArg,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
};
