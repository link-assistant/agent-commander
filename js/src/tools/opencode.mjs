/**
 * OpenCode CLI tool configuration
 * Based on hive-mind's opencode.lib.mjs implementation
 */

/**
 * Available OpenCode model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  gpt4: 'openai/gpt-4',
  gpt4o: 'openai/gpt-4o',
  claude: 'anthropic/claude-3-5-sonnet',
  sonnet: 'anthropic/claude-3-5-sonnet',
  opus: 'anthropic/claude-3-opus',
  gemini: 'google/gemini-pro',
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
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
 * Build command line arguments for OpenCode
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt (combined with user prompt)
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {string} [options.resume] - Resume session ID
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    model,
    json = true,
    resume,
  } = options;

  const args = ['run'];

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('--model', mappedModel);
  }

  if (json) {
    args.push('--format', 'json');
  }

  if (resume) {
    args.push('--resume', resume);
  }

  return args;
}

/**
 * Build complete command string for OpenCode
 * OpenCode uses stdin for prompt input
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {string} [options.resume] - Resume session ID
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  // eslint-disable-next-line no-unused-vars
  const { workingDirectory, prompt, systemPrompt, ...argOptions } = options;
  const args = buildArgs(argOptions);

  // OpenCode expects prompt via stdin, combine system and user prompts
  const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt || ''}` : (prompt || '');

  // Build command with stdin piping
  const escapedPrompt = combinedPrompt.replace(/'/g, "'\\''");
  return `printf '%s' '${escapedPrompt}' | opencode ${args.map(escapeArg).join(' ')}`.trim();
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
 * Parse JSON messages from OpenCode output
 * OpenCode outputs NDJSON format
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
    if (!trimmed || !trimmed.startsWith('{')) continue;

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
 * Extract session ID from OpenCode output
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
 * Extract usage statistics from OpenCode output
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
  };

  for (const msg of messages) {
    if (msg.usage) {
      const u = msg.usage;
      if (u.input_tokens) usage.inputTokens += u.input_tokens;
      if (u.output_tokens) usage.outputTokens += u.output_tokens;
    }
  }

  return usage;
}

/**
 * OpenCode tool configuration
 */
export const opencodeTool = {
  name: 'opencode',
  displayName: 'OpenCode CLI',
  executable: 'opencode',
  supportsJsonOutput: true,
  supportsJsonInput: true, // OpenCode can accept JSON input via stdin
  supportsSystemPrompt: false, // System prompt is combined with user prompt
  supportsResume: true,
  defaultModel: 'grok-code-fast-1',
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
};
