/**
 * Build command strings for different agent tools
 */

/**
 * Build the command for executing an agent
 * @param {Object} options - Command options
 * @param {string} options.tool - The CLI tool to use (e.g., 'claude')
 * @param {string} options.workingDirectory - Working directory path
 * @param {string} [options.prompt] - Prompt for the agent
 * @param {string} [options.systemPrompt] - System prompt for the agent
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
    isolation = 'none',
    screenName,
    containerName,
    detached = false,
  } = options;

  // Build base command
  let baseCommand = buildToolCommand(tool, workingDirectory, prompt, systemPrompt);

  // Apply isolation wrapper
  if (isolation === 'screen') {
    baseCommand = buildScreenCommand(baseCommand, screenName, detached);
  } else if (isolation === 'docker') {
    baseCommand = buildDockerCommand(baseCommand, containerName, workingDirectory, detached);
  }

  return baseCommand;
}

/**
 * Build the base tool command
 * @param {string} tool - Tool name
 * @param {string} workingDirectory - Working directory
 * @param {string} [prompt] - Prompt
 * @param {string} [systemPrompt] - System prompt
 * @returns {string} Base command
 */
function buildToolCommand(tool, workingDirectory, prompt, systemPrompt) {
  let toolCommand = tool;

  if (prompt) {
    toolCommand += ` --prompt "${escapeQuotes(prompt)}"`;
  }

  if (systemPrompt) {
    toolCommand += ` --system-prompt "${escapeQuotes(systemPrompt)}"`;
  }

  // Wrap in bash -c to ensure proper handling of cd && command
  const command = `bash -c "cd ${escapeForBashC(workingDirectory)} && ${escapeForBashC(toolCommand)}"`;

  return command;
}

/**
 * Build screen isolation command
 * @param {string} baseCommand - Base command to wrap
 * @param {string} [screenName] - Screen session name
 * @param {boolean} detached - Detached mode
 * @returns {string} Screen command
 */
function buildScreenCommand(baseCommand, screenName, detached) {
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
 * @param {string} baseCommand - Base command to wrap
 * @param {string} [containerName] - Container name
 * @param {string} workingDirectory - Working directory to mount
 * @param {boolean} detached - Detached mode
 * @returns {string} Docker command
 */
function buildDockerCommand(baseCommand, containerName, workingDirectory, detached) {
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
 * Escape quotes in strings for shell commands
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeQuotes(str) {
  return str.replace(/'/g, "'\\''");
}

/**
 * Escape strings for use inside bash -c "..."
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeForBashC(str) {
  // Escape backslashes first, then double quotes
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
}
