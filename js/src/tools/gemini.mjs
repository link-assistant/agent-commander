import { nativeUsage } from './usage.mjs';
/**
 * Gemini CLI tool configuration
 * Based on Google's official gemini-cli: https://github.com/google-gemini/gemini-cli
 */

import { syncedModels, syncedDefaults } from './model-catalog.mjs';

import { buildCommandHead, escapeArg, normalizeExtraArgs } from './shell.mjs';

/**
 * Available Gemini model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  ...syncedModels.gemini,
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
 * Build command line arguments for Gemini CLI
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt (for non-interactive mode)
 * @param {string} [options.systemPrompt] - System prompt (combined with user prompt)
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode (stream-json format)
 * @param {boolean} [options.yolo] - Auto-approve all tool calls (autonomous mode)
 * @param {boolean} [options.readOnly] - Use Gemini plan approval mode
 * @param {boolean} [options.sandbox] - Run tools in secure sandbox
 * @param {boolean} [options.debug] - Enable debug output
 * @param {boolean} [options.checkpointing] - Save project snapshot before file modifications
 * @param {boolean} [options.interactive] - Start interactive session with initial prompt
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {boolean} [options.skipDefaultSafetyFlags] - Do not add default bypass flags
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    prompt,
    model,
    resume,
    json = false,
    yolo = true, // Enable autonomous mode by default for agent use
    readOnly = false,
    sandbox = false,
    debug = false,
    checkpointing = false,
    interactive = false,
    extraArgs = [],
    skipDefaultSafetyFlags = false,
  } = options;

  const args = [];

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('-m', mappedModel);
  }

  if (readOnly) {
    args.push('--approval-mode', 'plan');
  } else if (yolo && !skipDefaultSafetyFlags) {
    // Enable yolo mode for autonomous execution (auto-approve all tool calls)
    args.push('--yolo');
  }

  if (resume) {
    args.push('--resume', resume);
  }

  // Sandbox mode for secure execution
  if (sandbox) {
    args.push('--sandbox');
  }

  // Debug output
  if (debug) {
    args.push('-d');
  }

  // Checkpointing for file modifications
  if (checkpointing) {
    args.push('--checkpointing');
  }

  // JSON output mode - use stream-json for streaming events
  if (json) {
    args.push('--output-format', 'stream-json');
  }

  // Add prompt for non-interactive mode
  if (prompt) {
    if (interactive) {
      args.push('-i', prompt);
    } else {
      args.push('-p', prompt);
    }
  }

  args.push(...normalizeExtraArgs(extraArgs));

  return args;
}

/**
 * Build complete command string for Gemini CLI
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {boolean} [options.yolo] - Auto-approve all tool calls
 * @param {boolean} [options.readOnly] - Use Gemini plan approval mode
 * @param {boolean} [options.sandbox] - Run tools in secure sandbox
 * @param {boolean} [options.debug] - Enable debug output
 * @param {boolean} [options.checkpointing] - Save project snapshot
 * @param {boolean} [options.interactive] - Start interactive session
 * @param {string} [options.promptFile] - File containing combined prompt input
 * @param {string} [options.executable='gemini'] - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Environment variables for the tool
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {boolean} [options.skipDefaultSafetyFlags] - Do not add default bypass flags
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  const {
    prompt,
    promptFile,
    systemPrompt,
    executable = 'gemini',
    extraEnv,
    // eslint-disable-next-line no-unused-vars
    workingDirectory,
    ...argOptions
  } = options;

  // Gemini CLI supports system prompt via GEMINI_SYSTEM_PROMPT env var
  // or via .gemini/system.md file. For now, combine with user prompt.
  const combinedPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt || ''}`
    : prompt || '';

  const args = buildArgs({
    ...argOptions,
    prompt: promptFile ? undefined : combinedPrompt,
  });
  const command =
    `${buildCommandHead({ executable, extraEnv })} ${args.map(escapeArg).join(' ')}`.trim();

  if (promptFile) {
    return `cat ${escapeArg(promptFile)} | ${command}`;
  }

  return command;
}

/**
 * Parse JSON messages from Gemini CLI output
 * Gemini CLI outputs NDJSON (newline-delimited JSON) in stream-json mode
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
 * Extract session ID from Gemini CLI output
 * Gemini CLI may include session information in its output
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
    // Gemini might use different session identifier
    if (msg.conversation_id) {
      return msg.conversation_id;
    }
  }

  return null;
}

/**
 * Extract usage statistics from Gemini CLI output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Usage statistics
 */
export function extractUsage({ output }) {
  return nativeUsage('gemini', parseOutput({ output }));
}

/**
 * Detect errors in Gemini CLI output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Error detection result
 */
export function detectErrors(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  for (const msg of messages) {
    // Check for explicit error message types
    if (msg.type === 'error' || msg.error) {
      return {
        hasError: true,
        errorType: msg.type || 'error',
        message: msg.message || msg.error || 'Unknown error',
      };
    }
  }

  return { hasError: false };
}

/**
 * Gemini CLI tool configuration
 */
export const geminiTool = {
  name: 'gemini',
  displayName: 'Gemini CLI',
  executable: 'gemini',
  supportsJsonOutput: true,
  supportsJsonInput: false, // Gemini CLI uses -p flag for prompts, not stdin JSON
  supportsSystemPrompt: false, // System prompt via env var or file, combined with user prompt
  supportsResume: true, // Native --resume SESSION in headless mode
  supportsYolo: true, // Supports --yolo for autonomous execution
  supportsSandbox: true, // Supports --sandbox for secure execution
  supportsCheckpointing: true, // Supports --checkpointing
  supportsDebug: true, // Supports -d for debug output
  supportsReadOnly: true, // Supports --approval-mode plan
  supportsAsk: false, // No JSON stdin channel (prompt via -p), so approvals cannot be relayed
  defaultModel: syncedDefaults.gemini,
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
  detectErrors,
};
