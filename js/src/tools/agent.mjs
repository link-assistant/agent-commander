/**
 * Agent CLI tool configuration (@link-assistant/agent)
 * Based on hive-mind's agent.lib.mjs implementation
 * Agent is a fork of OpenCode that ships a native, enforceable permission
 * system (agent v0.24.0, PR #272) exposed through `--permission-mode`
 * (auto | plan | readonly | ask) and an OpenCode-compatible `--permission`
 * JSON policy.
 */

import { syncedModels, syncedDefaults } from './model-catalog.mjs';
import { createModelMapper, parseJsonLines } from './json-lines.mjs';

import {
  buildCommandHead,
  escapeArg,
  escapeSingleQuotes,
  normalizeExtraArgs,
} from './shell.mjs';
import { firstErrorText, stringifyErrorValue } from '../error-text.mjs';

/**
 * Available Agent model configurations
 * Maps aliases to full model IDs (uses OpenCode's provider/model format)
 */
export const modelMap = {
  ...syncedModels.agent,
};

/**
 * Map model alias to full model ID
 * @param {Object} options - Options
 * @param {string} options.model - Model alias or full ID
 * @returns {string} Full model ID
 */
export const mapModelToId = createModelMapper(modelMap);

/**
 * Build command line arguments for Agent
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt (combined with user prompt)
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.compactJson] - Use compact JSON output
 * @param {boolean} [options.useExistingClaudeOAuth] - Use existing Claude OAuth credentials
 * @param {boolean} [options.readOnly] - Enforce hard read-only mode (`--permission-mode readonly`)
 * @param {boolean} [options.planOnly] - Enforce planning mode (`--permission-mode plan`)
 * @param {boolean} [options.approveEach] - Approve each mutating command (`--permission-mode ask`)
 * @param {string} [options.permissionMode] - Explicit agent permission mode (auto | plan | readonly | ask)
 * @param {string} [options.permission] - OpenCode-compatible `--permission` JSON policy
 * @param {boolean} [options.jsonInput] - Read stream-json user frames from stdin (live input)
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    model,
    resume,
    compactJson = false,
    useExistingClaudeOAuth = false,
    readOnly = false,
    planOnly = false,
    approveEach = false,
    permissionMode,
    permission,
    jsonInput = false,
    extraArgs = [],
  } = options;

  const args = [];
  if (resume) {
    args.push('--resume', resume, '--no-fork');
  }

  // Native, enforceable permission system (agent v0.24.0, PR #272).
  // --plan-only maps to `plan`, --read-only maps to the harder `readonly`,
  // --approve-each maps to `ask` (per-command approval relayed over JSON),
  // matching agent's own distinction between the modes. An explicit
  // permissionMode always wins.
  const resolvedPermissionMode =
    permissionMode ||
    (approveEach
      ? 'ask'
      : planOnly
        ? 'plan'
        : readOnly
          ? 'readonly'
          : undefined);
  if (resolvedPermissionMode) {
    args.push('--permission-mode', resolvedPermissionMode);
  }

  // Ask mode emits requests mid-turn and blocks until answered, so it requires
  // a streaming input mode (single-shot --prompt would deadlock). Live input
  // uses the same stream-json frames.
  if (resolvedPermissionMode === 'ask' || jsonInput) {
    args.push('--input-format', 'stream-json');
  }

  if (permission) {
    args.push('--permission', permission);
  }

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('--model', mappedModel);
  }

  if (compactJson) {
    args.push('--compact-json');
  }

  if (useExistingClaudeOAuth) {
    args.push('--use-existing-claude-oauth');
  }

  args.push(...normalizeExtraArgs(extraArgs));

  return args;
}

/**
 * Build complete command string for Agent
 * Agent uses stdin for prompt input (NDJSON streaming supported)
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.promptFile] - File containing combined prompt input
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.compactJson] - Use compact JSON output
 * @param {boolean} [options.useExistingClaudeOAuth] - Use existing Claude OAuth
 * @param {boolean} [options.readOnly] - Enforce hard read-only mode (`--permission-mode readonly`)
 * @param {boolean} [options.planOnly] - Enforce planning mode (`--permission-mode plan`)
 * @param {boolean} [options.approveEach] - Approve each mutating command (`--permission-mode ask`)
 * @param {string} [options.permissionMode] - Explicit agent permission mode (auto | plan | readonly | ask)
 * @param {string} [options.permission] - OpenCode-compatible `--permission` JSON policy
 * @param {string} [options.executable='agent'] - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Environment variables for the tool
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  const {
    prompt,
    promptFile,
    systemPrompt,
    executable = 'agent',
    extraEnv,
    streamInput = false,
    ...argOptions
  } = options;
  const args = buildArgs(argOptions);

  const commandHead = `${buildCommandHead({
    executable,
    extraEnv,
  })} ${args.map(escapeArg).join(' ')}`.trim();

  // In stream-input mode the caller owns the child's stdin and writes the
  // prompt and permission responses as NDJSON frames (per-command approval
  // relay), so no prompt is piped here.
  if (streamInput) {
    return commandHead;
  }

  // Agent expects prompt via stdin, combine system and user prompts
  const combinedPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt || ''}`
    : prompt || '';

  // Build command with stdin piping
  const inputCommand = promptFile
    ? `cat ${escapeArg(promptFile)}`
    : `printf '%s' '${escapeSingleQuotes(combinedPrompt)}'`;
  return `${inputCommand} | ${commandHead}`.trim();
}

/**
 * Parse JSON messages from Agent output
 * Agent pretty-prints JSON events by default and emits NDJSON with
 * `--compact-json`; both shapes are parsed by the record scanner.
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object[]} Array of parsed JSON messages
 */
export function parseOutput(options) {
  return parseJsonLines(options);
}

/**
 * Extract session ID from Agent output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {string|null} Session ID or null
 */
export function extractSessionId(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  for (const msg of messages) {
    if (msg.session_id || msg.sessionID) {
      return msg.session_id || msg.sessionID;
    }
  }

  return null;
}

/**
 * Parse token usage from Agent output
 * Agent outputs step_finish events with token data
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Token usage statistics
 */
export function extractUsage(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0,
  };

  for (const msg of messages) {
    // Look for step_finish events which contain token usage
    if (msg.type === 'step_finish' && msg.part?.tokens) {
      const tokens = msg.part.tokens;
      usage.stepCount++;

      // Add token counts
      if (tokens.input) {
        usage.inputTokens += tokens.input;
      }
      if (tokens.output) {
        usage.outputTokens += tokens.output;
      }
      if (tokens.reasoning) {
        usage.reasoningTokens += tokens.reasoning;
      }

      // Handle cache tokens
      if (tokens.cache) {
        if (tokens.cache.read) {
          usage.cacheReadTokens += tokens.cache.read;
        }
        if (tokens.cache.write) {
          usage.cacheWriteTokens += tokens.cache.write;
        }
      }

      // Add cost from step_finish
      if (msg.part.cost !== undefined) {
        usage.totalCost += msg.part.cost;
      }
    }
  }

  return usage;
}

/** Model/provider startup failures that leave the session unable to work (hive-mind#2141). */
const FATAL_AGENT_LOG_PATTERNS = [
  /ProviderModelNotFoundError/i,
  /ProviderInitError/i,
  /NoSuchModelError/i,
  /ModelNotFoundError/i,
  /failed to initialize .*model/i,
];

/**
 * Detect a `log` record reporting a fatal startup failure. Agent prints it,
 * then `session.idle`, and exits 0 without an `error` record (hive-mind#2141).
 * @param {Object} record - Agent JSON record
 * @returns {string|null} Readable failure text, or null when not fatal
 */
export function detectFatalAgentLogRecord(record) {
  if (record?.type !== 'log' || record.level !== 'error') {
    return null;
  }
  const error = stringifyErrorValue(record.error);
  const message = stringifyErrorValue(record.message);
  if (
    !FATAL_AGENT_LOG_PATTERNS.some((pattern) =>
      pattern.test(`${error} ${message}`)
    )
  ) {
    return null;
  }
  const hint = record.hint ? `hint: ${stringifyErrorValue(record.hint)}` : '';
  return [error, message, hint].filter(Boolean).join(' — ');
}

/**
 * A failed tool call is returned to the model as the tool result; agent 0.26.13
 * and earlier also repeated it as a top-level error record (agent#332,
 * hive-mind#3213). Only the session's own errors decide the run.
 * @param {Object} record - Agent JSON record
 * @returns {boolean}
 */
export function isRecoverableAgentToolError(record) {
  if (record?.type !== 'error' && record?.type !== 'step_error') {
    return false;
  }
  return (
    record.recoverable === true ||
    (record.part?.type === 'tool' && record.part.state?.status === 'error')
  );
}

/**
 * Detect errors in Agent output: the last fatal error record is the one the
 * session ended on; failed tool calls are skipped.
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Error detection result
 */
export function detectErrors(options) {
  const { output } = options;
  let detection = { hasError: false };

  for (const msg of parseOutput({ output })) {
    const fatalLog = detectFatalAgentLogRecord(msg);
    if (fatalLog) {
      detection = {
        hasError: true,
        errorType: stringifyErrorValue(msg.error) || 'fatal_log',
        message: fatalLog,
      };
    } else if (
      (msg.type === 'error' || msg.type === 'step_error') &&
      !isRecoverableAgentToolError(msg)
    ) {
      detection = {
        hasError: true,
        errorType:
          (typeof msg.error?.name === 'string' && msg.error.name) || msg.type,
        message: firstErrorText([msg.message, msg.error, msg.data], {
          fallback: 'Agent emitted an error event without any details',
        }),
      };
    }
  }

  return detection;
}

/**
 * Agent tool configuration
 */
export const agentTool = {
  name: 'agent',
  displayName: '@link-assistant/agent',
  executable: 'agent',
  supportsJsonOutput: true,
  supportsJsonInput: true, // Agent supports full JSON streaming input
  supportsSystemPrompt: false, // System prompt is combined with user prompt
  supportsResume: true, // --resume SESSION --no-fork preserves the session
  supportsReadOnly: true, // Native --permission-mode readonly/plan (agent v0.24.0, PR #272)
  supportsAsk: true, // Native --permission-mode ask with JSON permission relay
  supportsReasoningEffort: false, // No effort/variant flag (agent 0.26)
  reasoningEfforts: null,
  supportsMcpConfig: false, // No MCP config flag
  supportsStrictMcpConfig: false,
  supportsAdditionalDirectories: false, // No extra workspace directory flag
  supportsAttachments: false, // No attachment flag
  defaultModel: syncedDefaults.agent,
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
  detectErrors,
};
