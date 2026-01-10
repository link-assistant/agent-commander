/**
 * Tool configurations and utilities
 * Provides configuration for different CLI agents: claude, codex, opencode, agent, gemini
 */

import { claudeTool } from './claude.mjs';
import { codexTool } from './codex.mjs';
import { opencodeTool } from './opencode.mjs';
import { agentTool } from './agent.mjs';
import { geminiTool } from './gemini.mjs';

/**
 * Available tool configurations
 */
export const tools = {
  claude: claudeTool,
  codex: codexTool,
  opencode: opencodeTool,
  agent: agentTool,
  gemini: geminiTool,
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

export { claudeTool, codexTool, opencodeTool, agentTool, geminiTool };
