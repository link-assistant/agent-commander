/**
 * Build command strings for different agent tools
 */

import { isToolSupported, getTool } from './tools/index.mjs';

/**
 * Build the command for executing an agent
 * @param {Object} options - Command options
 * @param {string} options.tool - The CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'agent')
 * @param {string} options.workingDirectory - Working directory path
 * @param {string} [options.prompt] - Prompt for the agent
 * @param {string} [options.systemPrompt] - System prompt for the agent
 * @param {string} [options.model] - Model to use (tool-specific)
 * @param {boolean} [options.json] - Enable JSON output mode
 * @param {string} [options.resume] - Resume session ID (tool-specific)
 * @param {string} [options.isolation] - Isolation mode: 'none', 'screen', 'docker'
 * @param {string} [options.screenName] - Screen session name (for screen isolation)
 * @param {string} [options.containerName] - Container name (for docker isolation)
 * @param {boolean} [options.detached] - Run in detached mode
 * @returns {string} The command string
 */
export function buildAgentCommand(options) {
  const {
    tool,
    workingDirectory,
    prompt,
    systemPrompt,
    model,
    json,
    resume,
    isolation = 'none',
    screenName,
    containerName,
    detached = false,
    ...toolOptions
  } = options;

  // Build base command using tool-specific builder if available
  let baseCommand;

  if (isToolSupported({ toolName: tool })) {
    const toolConfig = getTool({ toolName: tool });
    if (toolConfig.buildCommand) {
      // Use tool-specific command builder
      baseCommand = toolConfig.buildCommand({
        workingDirectory,
        prompt,
        systemPrompt,
        model,
        json,
        resume,
        ...toolOptions,
      });
    } else {
      // Fall back to generic command builder
      baseCommand = buildToolCommand({
        tool,
        workingDirectory,
        prompt,
        systemPrompt,
      });
    }
  } else {
    // Unknown tool, use generic command builder
    baseCommand = buildToolCommand({
      tool,
      workingDirectory,
      prompt,
      systemPrompt,
    });
  }

  // Wrap in bash -c with working directory change
  let fullCommand = `bash -c "cd ${escapeForBashC(workingDirectory)} && ${escapeForBashC(baseCommand)}"`;

  // Apply isolation wrapper
  if (isolation === 'screen') {
    fullCommand = buildScreenCommand({
      baseCommand: fullCommand,
      screenName,
      detached,
    });
  } else if (isolation === 'docker') {
    fullCommand = buildDockerCommand({
      baseCommand: fullCommand,
      containerName,
      workingDirectory,
      detached,
    });
  }

  return fullCommand;
}

/**
 * Build the base tool command (generic)
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {string} options.workingDirectory - Working directory
 * @param {string} [options.prompt] - Prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @returns {string} Base command
 */
function buildToolCommand(options) {
  const { tool, prompt, systemPrompt } = options;
  let toolCommand = tool;

  if (prompt) {
    toolCommand += ` --prompt "${escapeQuotes(prompt)}"`;
  }

  if (systemPrompt) {
    toolCommand += ` --system-prompt "${escapeQuotes(systemPrompt)}"`;
  }

  return toolCommand;
}

/**
 * Build screen isolation command
 * @param {Object} options - Options
 * @param {string} options.baseCommand - Base command to wrap
 * @param {string} [options.screenName] - Screen session name
 * @param {boolean} [options.detached] - Detached mode
 * @returns {string} Screen command
 */
function buildScreenCommand(options) {
  const { baseCommand, screenName, detached = false } = options;
  const sessionName = screenName || `agent-${Date.now()}`;

  if (detached) {
    // Start detached screen session
    return `screen -dmS "${sessionName}" bash -c '${escapeQuotes(baseCommand)}'`;
  } else {
    // Start attached screen session
    return `screen -S "${sessionName}" bash -c '${escapeQuotes(baseCommand)}'`;
  }
}

/**
 * Build docker isolation command
 * @param {Object} options - Options
 * @param {string} options.baseCommand - Base command to wrap
 * @param {string} [options.containerName] - Container name
 * @param {string} options.workingDirectory - Working directory to mount
 * @param {boolean} [options.detached] - Detached mode
 * @returns {string} Docker command
 */
function buildDockerCommand(options) {
  const {
    baseCommand,
    containerName,
    workingDirectory,
    detached = false,
  } = options;
  const name = containerName || `agent-${Date.now()}`;

  let dockerCommand = 'docker run';

  if (detached) {
    dockerCommand += ' -d';
  } else {
    dockerCommand += ' -it';
  }

  dockerCommand += ` --name "${name}"`;
  dockerCommand += ` -v "${workingDirectory}:${workingDirectory}"`;
  dockerCommand += ` -w "${workingDirectory}"`;
  dockerCommand += ` node:18-slim`;
  dockerCommand += ` bash -c '${escapeQuotes(baseCommand)}'`;

  return dockerCommand;
}

/**
 * Build stop command for screen sessions
 * @param {string} screenName - Screen session name
 * @returns {string} Stop command
 */
export function buildScreenStopCommand(screenName) {
  return `screen -S "${screenName}" -X quit`;
}

/**
 * Build stop command for docker containers
 * @param {string} containerName - Container name
 * @returns {string} Stop command
 */
export function buildDockerStopCommand(containerName) {
  return `docker stop "${containerName}" && docker rm "${containerName}"`;
}

/**
 * Escape quotes in strings for shell commands (single quotes)
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeQuotes(str) {
  if (!str) {
    return '';
  }
  return str.replace(/'/g, "'\\''");
}

/**
 * Escape strings for use inside bash -c "..."
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeForBashC(str) {
  if (!str) {
    return '';
  }
  // Escape backslashes first, then double quotes, dollar signs, and backticks
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\$/g, '\\$')
    .replace(/`/g, '\\`');
}

/**
 * Build stdin piping command for tools that accept input via stdin
 * @param {Object} options - Options
 * @param {string} options.input - Input to pipe
 * @param {string} options.command - Command to pipe to
 * @returns {string} Piped command
 */
export function buildPipedCommand(options) {
  const { input, command } = options;
  const escapedInput = (input || '').replace(/'/g, "'\\''");
  return `printf '%s' '${escapedInput}' | ${command}`;
}
