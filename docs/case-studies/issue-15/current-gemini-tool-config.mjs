/**
 * Gemini CLI tool configuration
 * Based on Google's official gemini-cli: https://github.com/google-gemini/gemini-cli
 */

/**
 * Available Gemini model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  // Gemini 2.5 models (current stable)
  flash: 'gemini-2.5-flash',
  '2.5-flash': 'gemini-2.5-flash',
  pro: 'gemini-2.5-pro',
  '2.5-pro': 'gemini-2.5-pro',
  lite: 'gemini-2.5-flash-lite',
  '2.5-lite': 'gemini-2.5-flash-lite',
  // Gemini 3 models (latest generation)
  '3-flash': 'gemini-3-flash-preview',
  '3-pro': 'gemini-3-pro-preview',
  // Legacy aliases
  'gemini-flash': 'gemini-2.5-flash',
  'gemini-pro': 'gemini-2.5-pro',
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
 * @param {boolean} [options.sandbox] - Run tools in secure sandbox
 * @param {boolean} [options.debug] - Enable debug output
 * @param {boolean} [options.checkpointing] - Save project snapshot before file modifications
 * @param {boolean} [options.interactive] - Start interactive session with initial prompt
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    prompt,
    model,
    json = false,
    yolo = true, // Enable autonomous mode by default for agent use
    sandbox = false,
    debug = false,
    checkpointing = false,
    interactive = false,
  } = options;

  const args = [];

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('-m', mappedModel);
  }

  // Enable yolo mode for autonomous execution (auto-approve all tool calls)
  if (yolo) {
    args.push('--yolo');
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
 * @param {boolean} [options.sandbox] - Run tools in secure sandbox
 * @param {boolean} [options.debug] - Enable debug output
 * @param {boolean} [options.checkpointing] - Save project snapshot
 * @param {boolean} [options.interactive] - Start interactive session
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  // eslint-disable-next-line no-unused-vars
  const { workingDirectory, systemPrompt, prompt, ...argOptions } = options;

  // Gemini CLI supports system prompt via GEMINI_SYSTEM_PROMPT env var
  // or via .gemini/system.md file. For now, combine with user prompt.
  const combinedPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt || ''}`
    : prompt || '';

  const args = buildArgs({ ...argOptions, prompt: combinedPrompt });
  return `gemini ${args.map(escapeArg).join(' ')}`.trim();
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
export function extractUsage(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
  };

  for (const msg of messages) {
    // Check for usage metadata in different possible formats
    if (msg.usage) {
      const u = msg.usage;
      if (u.input_tokens !== undefined) {
        usage.inputTokens += u.input_tokens;
      }
      if (u.output_tokens !== undefined) {
        usage.outputTokens += u.output_tokens;
      }
      if (u.total_tokens !== undefined) {
        usage.totalTokens += u.total_tokens;
      }
      // Also check camelCase variants
      if (u.inputTokens !== undefined) {
        usage.inputTokens += u.inputTokens;
      }
      if (u.outputTokens !== undefined) {
        usage.outputTokens += u.outputTokens;
      }
      if (u.totalTokens !== undefined) {
        usage.totalTokens += u.totalTokens;
      }
    }

    // Also check for Gemini-specific token metrics
    if (msg.usageMetadata) {
      const u = msg.usageMetadata;
      if (u.promptTokenCount !== undefined) {
        usage.inputTokens += u.promptTokenCount;
      }
      if (u.candidatesTokenCount !== undefined) {
        usage.outputTokens += u.candidatesTokenCount;
      }
      if (u.totalTokenCount !== undefined) {
        usage.totalTokens += u.totalTokenCount;
      }
    }
  }

  // Calculate total if not provided
  if (
    usage.totalTokens === 0 &&
    (usage.inputTokens > 0 || usage.outputTokens > 0)
  ) {
    usage.totalTokens = usage.inputTokens + usage.outputTokens;
  }

  return usage;
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
  supportsResume: true, // Via /chat resume command in interactive mode
  supportsYolo: true, // Supports --yolo for autonomous execution
  supportsSandbox: true, // Supports --sandbox for secure execution
  supportsCheckpointing: true, // Supports --checkpointing
  supportsDebug: true, // Supports -d for debug output
  defaultModel: 'gemini-2.5-flash',
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
  detectErrors,
};
