/**
 * Agent Commander - Main library interface
 * A JavaScript library to control agents enclosed in CLI commands
 */

import { buildAgentCommand, buildScreenStopCommand, buildDockerStopCommand } from './command-builder.mjs';
import { executeCommand, executeDetached, setupSignalHandler } from './executor.mjs';

/**
 * Create an agent controller
 * @param {Object} options - Agent configuration
 * @param {string} options.tool - CLI tool to use (e.g., 'claude')
 * @param {string} options.workingDirectory - Working directory for the agent
 * @param {string} [options.prompt] - Prompt for the agent
 * @param {string} [options.systemPrompt] - System prompt for the agent
 * @param {string} [options.isolation='none'] - Isolation mode: 'none', 'screen', 'docker'
 * @param {string} [options.screenName] - Screen session name (for screen isolation)
 * @param {string} [options.containerName] - Container name (for docker isolation)
 * @returns {Object} Agent controller with start and stop methods
 */
export function agent(options) {
  const {
    tool,
    workingDirectory,
    prompt,
    systemPrompt,
    isolation = 'none',
    screenName,
    containerName,
  } = options;

  // Validate required options
  if (!tool) {
    throw new Error('tool is required');
  }
  if (!workingDirectory) {
    throw new Error('workingDirectory is required');
  }
  if (isolation === 'screen' && !screenName) {
    throw new Error('screenName is required for screen isolation');
  }
  if (isolation === 'docker' && !containerName) {
    throw new Error('containerName is required for docker isolation');
  }

  let processHandle = null;
  let removeSignalHandler = null;

  /**
   * Start the agent
   * @param {Object} [startOptions] - Start options
   * @param {boolean} [startOptions.dryRun] - If true, just show the command
   * @param {boolean} [startOptions.detached] - Run in detached mode
   * @param {boolean} [startOptions.attached=true] - Stream output to console
   * @returns {Promise<Object>} Result with exitCode, stdout, stderr
   */
  const start = async (startOptions = {}) => {
    const { dryRun = false, detached = false, attached = true } = startOptions;

    // Build the command
    const command = buildAgentCommand({
      tool,
      workingDirectory,
      prompt,
      systemPrompt,
      isolation,
      screenName,
      containerName,
      detached,
    });

    // Setup signal handler for graceful shutdown
    if (!dryRun && !detached && isolation === 'none') {
      removeSignalHandler = setupSignalHandler(async () => {
        console.log('Propagating shutdown to agent...');
        // The process will be terminated naturally by SIGINT
      });
    }

    try {
      if (detached && !dryRun) {
        // For detached mode, use executeDetached
        processHandle = await executeDetached(command);
        console.log(`Agent started in detached mode`);
        if (isolation === 'screen') {
          console.log(`Screen session: ${screenName}`);
        } else if (isolation === 'docker') {
          console.log(`Container: ${containerName}`);
        }
        return { exitCode: 0, stdout: '', stderr: '', pid: processHandle.pid };
      } else {
        // For attached or dry-run mode
        const result = await executeCommand(command, {
          dryRun,
          attached: !detached && attached,
        });

        return result;
      }
    } finally {
      if (removeSignalHandler) {
        removeSignalHandler();
      }
    }
  };

  /**
   * Stop the agent
   * @param {Object} [stopOptions] - Stop options
   * @param {boolean} [stopOptions.dryRun] - If true, just show the command
   * @returns {Promise<Object>} Result with exitCode
   */
  const stop = async (stopOptions = {}) => {
    const { dryRun = false } = stopOptions;

    if (isolation === 'none') {
      throw new Error('Cannot stop agent with no isolation. Use CTRL+C to stop.');
    }

    let command;
    if (isolation === 'screen') {
      if (!screenName) {
        throw new Error('screenName is required to stop screen session');
      }
      command = buildScreenStopCommand(screenName);
    } else if (isolation === 'docker') {
      if (!containerName) {
        throw new Error('containerName is required to stop docker container');
      }
      command = buildDockerStopCommand(containerName);
    }

    const result = await executeCommand(command, { dryRun, attached: true });
    return result;
  };

  return {
    start,
    stop,
  };
}

// Export other utilities if needed
export { buildAgentCommand, buildScreenStopCommand, buildDockerStopCommand } from './command-builder.mjs';
export { executeCommand, executeDetached, setupSignalHandler } from './executor.mjs';
