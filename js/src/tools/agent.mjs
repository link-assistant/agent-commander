/**
 * Agent CLI tool configuration (@link-assistant/agent)
 * Based on hive-mind's agent.lib.mjs implementation
 * Agent is a fork of OpenCode that ships a native, enforceable permission
 * system (agent v0.24.0, PR #272) exposed through `--permission-mode`
 * (auto | plan | readonly | ask) and an OpenCode-compatible `--permission`
 * JSON policy.
 */

import { syncedModels, syncedDefaults } from './model-catalog.mjs';

import { buildCommandHead, escapeArg, normalizeExtraArgs } from './shell.mjs';

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
export function mapModelToId(options) {
  const { model } = options;
  return modelMap[model] || model;
}

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
  // a streaming input mode (single-shot --prompt would deadlock).
  if (resolvedPermissionMode === 'ask') {
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
    : `printf '%s' '${combinedPrompt.replace(/'/g, "'\\''")}'`;
  return `${inputCommand} | ${commandHead}`.trim();
}

/**
 * Parse JSON messages from Agent output
 * Agent outputs NDJSON format with specific event types
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object[]} Array of parsed JSON messages
 */
export function parseOutput(options) {
  const { output } = options;
  const messages = [];
  const lines = output.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed);
      messages.push(parsed);
    } catch {
      // Skip lines that aren't valid JSON
    }
  }

  return messages;
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

/**
 * Detect errors in Agent output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Error detection result
 */
export function detectErrors(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  for (const msg of messages) {
    // Check for explicit error message types from agent
    if (msg.type === 'error' || msg.type === 'step_error') {
      return {
        hasError: true,
        errorType: msg.type,
        message: msg.message || 'Unknown error',
      };
    }
  }

  return { hasError: false };
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
