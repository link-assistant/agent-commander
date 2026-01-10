/**
 * Qwen Code CLI tool configuration
 * Based on https://github.com/QwenLM/qwen-code
 * Qwen Code is an open-source AI agent optimized for Qwen3-Coder models
 */

/**
 * Available Qwen Code model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  'qwen3-coder': 'qwen3-coder-480a35',
  'qwen3-coder-480a35': 'qwen3-coder-480a35',
  'qwen3-coder-30ba3': 'qwen3-coder-30ba3',
  coder: 'qwen3-coder-480a35',
  'gpt-4o': 'gpt-4o',
  'gpt-4': 'gpt-4',
  sonnet: 'claude-sonnet-4',
  opus: 'claude-opus-4',
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
 * Build command line arguments for Qwen Code
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt (combined with user prompt)
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {boolean} [options.streamJson] - Stream JSON output mode (NDJSON)
 * @param {boolean} [options.includePartialMessages] - Include partial messages in stream-json
 * @param {boolean} [options.yolo] - Auto-approve all actions
 * @param {string} [options.resume] - Resume session ID
 * @param {boolean} [options.continueSession] - Continue most recent session
 * @param {boolean} [options.allFiles] - Include all files in context
 * @param {string[]} [options.includeDirectories] - Directories to include
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    prompt,
    model,
    json = false,
    streamJson = true,
    includePartialMessages = false,
    yolo = true,
    resume,
    continueSession = false,
    allFiles = false,
    includeDirectories,
  } = options;

  const args = [];

  // Prompt (triggers headless mode)
  if (prompt) {
    args.push('-p', prompt);
  }

  // Model configuration
  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('--model', mappedModel);
  }

  // Output format - prefer stream-json for real-time streaming
  if (streamJson) {
    args.push('--output-format', 'stream-json');
  } else if (json) {
    args.push('--output-format', 'json');
  }

  // Include partial messages for real-time UI updates
  if (includePartialMessages && streamJson) {
    args.push('--include-partial-messages');
  }

  // Auto-approve all actions for autonomous execution
  if (yolo) {
    args.push('--yolo');
  }

  // Session management
  if (resume) {
    args.push('--resume', resume);
  } else if (continueSession) {
    args.push('--continue');
  }

  // Context options
  if (allFiles) {
    args.push('--all-files');
  }

  if (includeDirectories && includeDirectories.length > 0) {
    for (const dir of includeDirectories) {
      args.push('--include-directories', dir);
    }
  }

  return args;
}

/**
 * Build complete command string for Qwen Code
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {boolean} [options.streamJson] - Stream JSON output mode (NDJSON)
 * @param {boolean} [options.includePartialMessages] - Include partial messages
 * @param {boolean} [options.yolo] - Auto-approve all actions
 * @param {string} [options.resume] - Resume session ID
 * @param {boolean} [options.continueSession] - Continue most recent session
 * @param {boolean} [options.allFiles] - Include all files in context
 * @param {string[]} [options.includeDirectories] - Directories to include
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  // eslint-disable-next-line no-unused-vars
  const { workingDirectory, systemPrompt, ...argOptions } = options;

  // Combine system prompt with user prompt if provided
  if (systemPrompt && argOptions.prompt) {
    argOptions.prompt = `${systemPrompt}\n\n${argOptions.prompt}`;
  } else if (systemPrompt) {
    argOptions.prompt = systemPrompt;
  }

  const args = buildArgs(argOptions);
  return `qwen ${args.map(escapeArg).join(' ')}`.trim();
}

/**
 * Escape an argument for shell usage
 * @param {string} arg - Argument to escape
 * @returns {string} Escaped argument
 */
function escapeArg(arg) {
  if (/["\s$`\\]/.test(arg)) {
    return `"${arg.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`').replace(/\\/g, '\\\\')}"`;
  }
  return arg;
}

/**
 * Parse JSON messages from Qwen Code output
 * Qwen Code outputs NDJSON (newline-delimited JSON) in stream-json mode
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
 * Extract session ID from Qwen Code output
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
    // Also check for sessionId format
    if (msg.sessionId) {
      return msg.sessionId;
    }
  }

  return null;
}

/**
 * Extract usage statistics from Qwen Code output
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
    // Check for usage in message
    if (msg.usage) {
      const u = msg.usage;
      if (u.input_tokens) {
        usage.inputTokens += u.input_tokens;
      }
      if (u.output_tokens) {
        usage.outputTokens += u.output_tokens;
      }
      if (u.total_tokens) {
        usage.totalTokens += u.total_tokens;
      }
    }

    // Check for usage in result message
    if (msg.result?.usage) {
      const u = msg.result.usage;
      if (u.input_tokens) {
        usage.inputTokens += u.input_tokens;
      }
      if (u.output_tokens) {
        usage.outputTokens += u.output_tokens;
      }
      if (u.total_tokens) {
        usage.totalTokens += u.total_tokens;
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
 * Detect errors in Qwen Code output
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object} Error detection result
 */
export function detectErrors(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  for (const msg of messages) {
    if (msg.type === 'error' || msg.error) {
      return {
        hasError: true,
        errorType: msg.type || 'error',
        message: msg.error || msg.message || 'Unknown error',
      };
    }
  }

  return { hasError: false };
}

/**
 * Qwen Code tool configuration
 */
export const qwenTool = {
  name: 'qwen',
  displayName: 'Qwen Code CLI',
  executable: 'qwen',
  supportsJsonOutput: true,
  supportsJsonInput: true, // Qwen Code supports stream-json input format
  supportsSystemPrompt: false, // System prompt is combined with user prompt
  supportsResume: true, // Supports --resume and --continue
  supportsContinueSession: true, // Supports --continue for most recent session
  supportsYolo: true, // Supports --yolo for auto-approval
  supportsAllFiles: true, // Supports --all-files
  supportsIncludeDirectories: true, // Supports --include-directories
  supportsIncludePartialMessages: true, // Supports --include-partial-messages
  defaultModel: 'qwen3-coder-480a35',
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
  detectErrors,
};
