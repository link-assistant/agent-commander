import { nativeUsage } from './usage.mjs';
import { syncedModels, syncedDefaults } from './model-catalog.mjs';
import { createModelMapper, parseJsonLines } from './json-lines.mjs';
/**
 * OpenCode CLI tool configuration
 * Based on hive-mind's opencode.lib.mjs implementation
 */

import {
  buildCommandHead,
  escapeArg,
  escapeSingleQuotes,
  normalizeExtraArgs,
  normalizeExtraEnv,
} from './shell.mjs';
import {
  normalizeAttachments,
  normalizeReasoningEffort,
} from './launch-options.mjs';

const READ_ONLY_PERMISSION = '{"edit":"deny","bash":"deny","task":"deny"}';

/**
 * Available OpenCode model configurations
 * Maps aliases to full model IDs
 */
export const modelMap = {
  ...syncedModels.opencode,
};

/**
 * Map model alias to full model ID
 * @param {Object} options - Options
 * @param {string} options.model - Model alias or full ID
 * @returns {string} Full model ID
 */
export const mapModelToId = createModelMapper(modelMap);

/**
 * Build command line arguments for OpenCode
 * @param {Object} options - Options
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt (combined with user prompt)
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {string} [options.resume] - Resume session ID
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @param {string} [options.reasoningEffort] - Provider-specific variant (`--variant`)
 * @param {string[]} [options.attachments] - Files attached to the message (`--file`)
 * @returns {string[]} Array of CLI arguments
 */
export function buildArgs(options) {
  const {
    model,
    json = true,
    resume,
    extraArgs = [],
    reasoningEffort,
    attachments,
  } = options;

  const args = ['run'];

  // `--file` is a yargs array that would swallow a following positional, so
  // each path gets its own flag right after the subcommand.
  for (const file of normalizeAttachments(attachments)) {
    args.push('--file', file);
  }

  if (model) {
    const mappedModel = mapModelToId({ model });
    args.push('--model', mappedModel);
  }

  if (json) {
    args.push('--format', 'json');
  }

  if (resume) {
    args.push('--session', resume);
  }

  if (reasoningEffort) {
    args.push('--variant', normalizeReasoningEffort(reasoningEffort));
  }

  args.push(...normalizeExtraArgs(extraArgs));

  return args;
}

/**
 * Build complete command string for OpenCode
 * OpenCode uses stdin for prompt input
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.promptFile] - File containing combined prompt input
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.model] - Model to use
 * @param {boolean} [options.json] - JSON output mode
 * @param {string} [options.resume] - Resume session ID
 * @param {boolean} [options.readOnly] - Deny OpenCode edit, bash, and task permissions
 * @param {string} [options.executable='opencode'] - Executable path/name
 * @param {Object|Array} [options.extraEnv] - Environment variables for the tool
 * @param {string[]} [options.extraArgs] - Extra raw CLI args appended after typed args
 * @returns {string} Complete command string
 */
export function buildCommand(options) {
  const {
    prompt,
    promptFile,
    systemPrompt,
    readOnly = false,
    executable = 'opencode',
    extraEnv,
    ...argOptions
  } = options;
  const args = buildArgs(argOptions);

  // OpenCode expects prompt via stdin, combine system and user prompts
  const combinedPrompt = systemPrompt
    ? `${systemPrompt}\n\n${prompt || ''}`
    : prompt || '';

  // Build command with stdin piping
  const inputCommand = promptFile
    ? `cat ${escapeArg(promptFile)}`
    : `printf '%s' '${escapeSingleQuotes(combinedPrompt)}'`;
  const env = readOnly
    ? [
        ['OPENCODE_PERMISSION', READ_ONLY_PERMISSION],
        ...normalizeExtraEnv(extraEnv),
      ]
    : extraEnv;

  return `${inputCommand} | ${buildCommandHead({
    executable,
    extraEnv: env,
  })} ${args.map(escapeArg).join(' ')}`.trim();
}

/**
 * Parse JSON messages from OpenCode output
 * OpenCode outputs NDJSON format
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object[]} Array of parsed JSON messages
 */
export function parseOutput(options) {
  return parseJsonLines(options);
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
    if (msg.session_id || msg.sessionID) {
      return msg.session_id || msg.sessionID;
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
export function extractUsage({ output }) {
  return nativeUsage('opencode', parseOutput({ output }));
}

/**
 * OpenCode tool configuration
 */
export const opencodeTool = {
  name: 'opencode',
  displayName: 'OpenCode CLI',
  executable: 'opencode',
  supportsJsonOutput: true,
  supportsJsonInput: false, // stdin carries plain prompt text
  supportsSystemPrompt: false, // System prompt is combined with user prompt
  supportsResume: true,
  supportsReadOnly: true, // Supports OPENCODE_PERMISSION
  supportsAsk: false, // Only a static up-front policy; no per-command request/response relay
  supportsReasoningEffort: true, // --variant <provider-specific level>
  reasoningEfforts: null, // Variants are defined by the model provider
  supportsMcpConfig: false, // MCP servers come from opencode.json only
  supportsStrictMcpConfig: false,
  supportsAdditionalDirectories: false, // No extra workspace directory flag
  supportsAttachments: true, // run --file <file>
  supportsJsonSchema: false, // No structured-output flag (opencode 1.19)
  defaultModel: syncedDefaults.opencode,
  modelMap,
  mapModelToId,
  buildArgs,
  buildCommand,
  parseOutput,
  extractSessionId,
  extractUsage,
};
