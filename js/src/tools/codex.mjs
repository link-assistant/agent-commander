/**
 * Codex CLI tool configuration
 * Based on hive-mind's codex.lib.mjs implementation
 */

import { buildCommandHead, escapeArg, normalizeExtraArgs } from './shell.mjs';

/**
 * Available Codex model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  gpt5: 'gpt-5',
  'gpt-5': 'gpt-5',
  'gpt5-codex': 'gpt-5-codex',
  // GPT-5.5 family (hive-mind PR #1657, default)
  'gpt-5.5': 'gpt-5.5',
  'gpt-5.5-mini': 'gpt-5.5-mini',
  'gpt-5.5-nano': 'gpt-5.5-nano',
  // GPT-5.4 family
  'gpt-5.4': 'gpt-5.4',
  'gpt-5.4-mini': 'gpt-5.4-mini',
  'gpt-5.4-nano': 'gpt-5.4-nano',
  // GPT-5.3 family (codex variants)
  'gpt-5.3-codex': 'gpt-5.3-codex',
  'gpt-5.3-codex-spark': 'gpt-5.3-codex-spark',
  // GPT-5.2 family
  'gpt-5.2': 'gpt-5.2',
  'gpt-5.2-codex': 'gpt-5.2-codex',
  // GPT-5.1 family
  'gpt-5.1-codex-max': 'gpt-5.1-codex-max',
  o3: 'o3',
  'o3-mini': 'o3-mini',
  gpt4: 'gpt-4',
  'gpt-4': 'gpt-4',
  gpt4o: 'gpt-4o',
  'gpt-4o': 'gpt-4o',
  claude: 'claude-3-5-sonnet',
  sonnet: 'claude-3-5-sonnet',
  opus: 'claude-3-opus',
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
 * Build command line arguments for Codex
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt (combined with system prompt)
 * @param {string} [options.systemPrompt] - System prompt (prepended to prompt)
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {string} [options.resume] - Resume session/thread ID
 * @param {boolean} [options.readOnly] - Use Codex read-only sandbox
 * @param {string} [options.sandboxMode] - Explicit Codex sandbox mode
 * @param {string} [options.approvalMode] - Explicit Codex approval mode
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {boolean} [options.skipDefaultSafetyFlags] - Do not add default bypass flags
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    model,
    json = true,
    resume,
    readOnly = false,
    sandboxMode,
    approvalMode,
    extraArgs = [],
    skipDefaultSafetyFlags = false,
  } = options;

  const args = ['exec'];

  if (resume) {
    args.push('resume', resume);
  }

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('--model', mappedModel);
  }

  if (json) {
    args.push('--json');
  }

  // Codex-specific flags for autonomous execution
  args.push('--skip-git-repo-check');
  if (readOnly) {
    args.push('--sandbox', 'read-only');
  } else if (sandboxMode) {
    args.push('--sandbox', sandboxMode);
  }

  if (!readOnly && !sandboxMode && !approvalMode && !skipDefaultSafetyFlags) {
    args.push('--dangerously-bypass-approvals-and-sandbox');
  }

  args.push(...normalizeExtraArgs(extraArgs));

  return args;
}

/**
 * Build complete command string for Codex
 * Codex uses stdin for prompt input
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.promptFile] - File containing combined prompt input
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {string} [options.resume] - Resume session ID
 * @param {boolean} [options.readOnly] - Use Codex read-only sandbox
 * @param {string} [options.executable='codex'] - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Environment variables for the tool
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {string} [options.sandboxMode] - Explicit Codex sandbox mode
 * @param {string} [options.approvalMode] - Explicit Codex approval mode
 * @param {boolean} [options.skipDefaultSafetyFlags] - Do not add default bypass flags
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  const {
    prompt,
    promptFile,
    systemPrompt,
    executable = 'codex',
    extraEnv,
    ...argOptions
  } = options;
  const args = buildArgs(argOptions);

  // Codex expects prompt via stdin, combine system and user prompts
  const combinedPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt || ''}`
    : prompt || '';

  // Build command with stdin piping
  const inputCommand = promptFile
    ? `cat ${escapeArg(promptFile)}`
    : `printf '%s' '${combinedPrompt.replace(/'/g, "'\\''")}'`;
  const prefixArgs = [];
  if (argOptions.readOnly) {
    prefixArgs.push('--ask-for-approval', 'never');
  } else if (argOptions.approvalMode) {
    prefixArgs.push('--ask-for-approval', argOptions.approvalMode);
  }

  return `${inputCommand} | ${buildCommandHead({
    executable,
    extraEnv,
    prefixArgs,
  })} ${args.map(escapeArg).join(' ')}`.trim();
}

/**
 * Parse JSON messages from Codex output
 * Codex outputs NDJSON format
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
 * Extract session/thread ID from Codex output
 * Codex uses thread_id instead of session_id
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {string|null} Session ID or null
 */
export function extractSessionId(options) {
  const { output } = options;
  const messages = parseOutput({ output });

  for (const msg of messages) {
    if (msg.thread_id) {
      return msg.thread_id;
    }
    if (msg.session_id) {
      return msg.session_id;
    }
  }

  return null;
}

/**
 * Extract usage statistics from Codex output
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
      if (u.input_tokens) {
        usage.inputTokens += u.input_tokens;
      }
      if (u.output_tokens) {
        usage.outputTokens += u.output_tokens;
      }
    }
  }

  return usage;
}

/**
 * Codex tool configuration
 */
export const codexTool = {
  name: 'codex',
  displayName: 'Codex CLI',
  executable: 'codex',
  supportsJsonOutput: true,
  supportsJsonInput: true, // Codex can accept JSON input via stdin
  supportsSystemPrompt: false, // System prompt is combined with user prompt
  supportsResume: true,
  supportsReadOnly: true, // Supports --sandbox read-only
  defaultModel: 'gpt-5.5', // hive-mind PR #1657
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
};
