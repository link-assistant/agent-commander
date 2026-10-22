/**
 * Tool configurations and utilities
 * Provides configuration for different CLI agents: claude, codex, opencode, agent, gemini, qwen
 */

import { claudeTool } from './claude.mjs';
import { codexTool } from './codex.mjs';
import { opencodeTool } from './opencode.mjs';
import { agentTool } from './agent.mjs';
import { geminiTool } from './gemini.mjs';
import { qwenTool } from './qwen.mjs';

/**
 * Available tool configurations
 */
export const tools = {
  claude: claudeTool,
  codex: codexTool,
  opencode: opencodeTool,
  agent: agentTool,
  gemini: geminiTool,
  qwen: qwenTool,
};

/**
 * Get tool configuration by name
 * @param {Object} options - Options
 * @param {string} options.toolName - Name of the tool
 * @returns {Object} Tool configuration
 */
export function getTool(options) {
  const { toolName } = options;
  const tool = tools[toolName];
  if (!tool) {
    throw new Error(
      `Unknown tool: ${toolName}. Available tools: ${Object.keys(tools).join(', ')}`
    );
  }
  return tool;
}

/**
 * Resolve the configuration a run uses: the registered tool with the caller's
 * overrides on top. Overrides replace a failing or missing part (command
 * builder, output parser, session ID or usage extractor, capability flags)
 * for one run without waiting for a release; with a `buildCommand` they also
 * drive a tool that is not registered.
 * @param {Object} options - Options
 * @param {string} options.toolName - Name of the tool
 * @param {Object} [options.toolOverrides] - Tool configuration fields to replace
 * @returns {Object|undefined} Tool configuration, or undefined for an unknown tool without overrides
 */
export function resolveToolConfig(options) {
  const { toolName, toolOverrides } = options;
  const base = isToolSupported({ toolName })
    ? getTool({ toolName })
    : undefined;
  if (!toolOverrides) {
    return base;
  }
  if (typeof toolOverrides !== 'object' || Array.isArray(toolOverrides)) {
    throw new Error(
      'toolOverrides must be an object of tool configuration fields'
    );
  }
  return { ...base, ...toolOverrides, name: base?.name ?? toolName };
}

/**
 * List available tools
 * @returns {string[]} Array of tool names
 */
export function listTools() {
  return Object.keys(tools);
}

/**
 * Check if a tool is supported
 * @param {Object} options - Options
 * @param {string} options.toolName - Name of the tool
 * @returns {boolean} True if tool is supported
 */
export function isToolSupported(options) {
  const { toolName } = options;
  return toolName in tools;
}

export { claudeTool, codexTool, opencodeTool, agentTool, geminiTool, qwenTool };
