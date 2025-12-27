/**
 * Agent CLI tool configuration (@link-assistant/agent)
 * Based on hive-mind's agent.lib.mjs implementation
 * Agent is a fork of OpenCode with unrestricted permissions for autonomous execution
 */

/**
 * Available Agent model configurations
 * Maps aliases to full model IDs (uses OpenCode's provider/model format)
 */
export const modelMap = {
  grok: 'opencode/grok-code',
  'grok-code': 'opencode/grok-code',
  'grok-code-fast-1': 'opencode/grok-code',
  'big-pickle': 'opencode/big-pickle',
  'gpt-5-nano': 'openai/gpt-5-nano',
  sonnet: 'anthropic/claude-3-5-sonnet',
  haiku: 'anthropic/claude-3-5-haiku',
  opus: 'anthropic/claude-3-opus',
  'gemini-3-pro': 'google/gemini-3-pro',
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
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    model,
    compactJson = false,
    useExistingClaudeOAuth = false,
  } = options;

  const args = [];

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

  return args;
}

/**
 * Build complete command string for Agent
 * Agent uses stdin for prompt input (NDJSON streaming supported)
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.compactJson] - Use compact JSON output
 * @param {boolean} [options.useExistingClaudeOAuth] - Use existing Claude OAuth
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  // eslint-disable-next-line no-unused-vars
  const { workingDirectory, prompt, systemPrompt, ...argOptions } = options;
  const args = buildArgs(argOptions);

  // Agent expects prompt via stdin, combine system and user prompts
  const combinedPrompt = systemPrompt ? `${systemPrompt}\n\n${prompt || ''}` : (prompt || '');

  // Build command with stdin piping
  const escapedPrompt = combinedPrompt.replace(/'/g, "'\\''");
  return `printf '%s' '${escapedPrompt}' | agent ${args.map(escapeArg).join(' ')}`.trim();
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
 * Extract session ID from Agent output
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
      if (tokens.input) usage.inputTokens += tokens.input;
      if (tokens.output) usage.outputTokens += tokens.output;
      if (tokens.reasoning) usage.reasoningTokens += tokens.reasoning;

      // Handle cache tokens
      if (tokens.cache) {
        if (tokens.cache.read) usage.cacheReadTokens += tokens.cache.read;
        if (tokens.cache.write) usage.cacheWriteTokens += tokens.cache.write;
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
  supportsResume: false, // Agent doesn't have explicit resume like Claude
  defaultModel: 'grok-code-fast-1',
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
  detectErrors,
};
