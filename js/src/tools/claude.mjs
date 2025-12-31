/**
 * Claude CLI tool configuration
 * Based on hive-mind's claude.lib.mjs implementation
 */

/**
 * Available Claude model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  sonnet: 'claude-sonnet-4-5-20250929',
  opus: 'claude-opus-4-5-20251101',
  haiku: 'claude-haiku-4-5-20251001',
  'haiku-3-5': 'claude-3-5-haiku-20241022',
  'haiku-3': 'claude-3-haiku-20240307',
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
 * @param {boolean} [options.dangerouslySkipPermissions] - Bypass all permission checks (default: true)
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
    dangerouslySkipPermissions = true, // Always enabled by default per issue #3
  } = options;

  const args = [];

  // Permission bypass - always first for security-related flags
  if (dangerouslySkipPermissions) {
    args.push('--dangerously-skip-permissions');
  }

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('--model', mappedModel);
  }

  if (fallbackModel) {
    const mappedFallback = mapModelToId({ model: fallbackModel });
    args.push('--fallback-model', mappedFallback);
  }

  if (prompt) {
    args.push('--prompt', prompt);
  }

  if (systemPrompt) {
    args.push('--system-prompt', systemPrompt);
  }

  if (appendSystemPrompt) {
    args.push('--append-system-prompt', appendSystemPrompt);
  }

  if (verbose) {
    args.push('--verbose');
  }

  if (print) {
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

  return args;
}

/**
 * Build complete command string for Claude
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
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
 * @param {boolean} [options.dangerouslySkipPermissions] - Bypass all permission checks (default: true)
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  // eslint-disable-next-line no-unused-vars
  const { workingDirectory, ...argOptions } = options;
  const args = buildArgs(argOptions);
  return `claude ${args.map(escapeArg).join(' ')}`.trim();
}

/**
 * Escape an argument for shell usage
 * @param {string} arg - Argument to escape
 * @returns {string} Escaped argument
 */
function escapeArg(arg) {
  // If argument contains spaces, quotes, or special chars, wrap in quotes
  if (/["\s$`\\]/.test(arg)) {
    return `"${arg.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`').replace(/\\/g, '\\\\')}"`;
  }
  return arg;
}

/**
 * Parse JSON messages from Claude output
 * Claude outputs NDJSON (newline-delimited JSON) in JSON mode
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
export function extractUsage(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };

  for (const msg of messages) {
    if (msg.message?.usage) {
      const u = msg.message.usage;
      if (u.input_tokens) {
        usage.inputTokens += u.input_tokens;
      }
      if (u.output_tokens) {
        usage.outputTokens += u.output_tokens;
      }
      if (u.cache_creation_input_tokens) {
        usage.cacheCreationTokens += u.cache_creation_input_tokens;
      }
      if (u.cache_read_input_tokens) {
        usage.cacheReadTokens += u.cache_read_input_tokens;
      }
    }
  }

  return usage;
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
  defaultModel: 'sonnet',
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
};
