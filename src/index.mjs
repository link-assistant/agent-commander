/**
 * Agent Commander - Main library interface
 * A JavaScript library to control agents enclosed in CLI commands
 */

import { buildAgentCommand, buildScreenStopCommand, buildDockerStopCommand } from './command-builder.mjs';
import { executeCommand, executeDetached, setupSignalHandler, startCommand } from './executor.mjs';

/**
 * Parse JSON messages from output if the tool supports it
 * @param {string} output - Raw output to parse
 * @returns {Array|null} Array of parsed JSON messages or null if parsing fails
 */
function parseJsonMessages(output) {
  try {
    // Try to parse as JSON array
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // If single object, wrap in array
    return [parsed];
  } catch {
    // Try to extract JSON objects line by line
    const lines = output.split('\n');
    const messages = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed);
          messages.push(parsed);
        } catch {
          // Skip lines that aren't valid JSON
        }
      }
    }
    return messages.length > 0 ? messages : null;
  }
}

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
  let command = null;

  /**
   * Start the agent (non-blocking)
   * @param {Object} [startOptions] - Start options
   * @param {boolean} [startOptions.dryRun] - If true, just show the command
   * @param {boolean} [startOptions.detached] - Run in detached mode
   * @param {boolean} [startOptions.attached=true] - Stream output to console
   * @returns {Promise<void>} Resolves when process is started (not when it exits)
   */
  const start = async (startOptions = {}) => {
    const { dryRun = false, detached = false, attached = true } = startOptions;

    // Build the command
    command = buildAgentCommand({
      tool,
      workingDirectory,
      prompt,
      systemPrompt,
      isolation,
      screenName,
      containerName,
      detached,
    });

    if (dryRun) {
      console.log('Dry run - command that would be executed:');
      console.log(command);
      return;
    }

    // Setup signal handler for graceful shutdown
    if (!detached && isolation === 'none') {
      removeSignalHandler = setupSignalHandler(async () => {
        console.log('Propagating shutdown to agent...');
        // The process will be terminated naturally by SIGINT
      });
    }

    if (detached) {
      // For detached mode, use executeDetached
      processHandle = await executeDetached(command);
      console.log(`Agent started in detached mode`);
      if (isolation === 'screen') {
        console.log(`Screen session: ${screenName}`);
      } else if (isolation === 'docker') {
        console.log(`Container: ${containerName}`);
      }
    } else {
      // For attached mode, start command without waiting
      processHandle = await startCommand(command, { attached });
    }
  };

  /**
   * Stop the agent and collect output
   * @param {Object} [stopOptions] - Stop options
   * @param {boolean} [stopOptions.dryRun] - If true, just show the command
   * @returns {Promise<Object>} Result with exitCode, output.plain, and output.parsed
   */
  const stop = async (stopOptions = {}) => {
    const { dryRun = false } = stopOptions;

    // For isolation modes, send stop command
    if (isolation === 'screen' || isolation === 'docker') {
      let stopCommand;
      if (isolation === 'screen') {
        if (!screenName) {
          throw new Error('screenName is required to stop screen session');
        }
        stopCommand = buildScreenStopCommand(screenName);
      } else if (isolation === 'docker') {
        if (!containerName) {
          throw new Error('containerName is required to stop docker container');
        }
        stopCommand = buildDockerStopCommand(containerName);
      }

      if (dryRun) {
        console.log('Dry run - command that would be executed:');
        console.log(stopCommand);
        return { exitCode: 0, output: { plain: '', parsed: null } };
      }

      const result = await executeCommand(stopCommand, { dryRun, attached: true });
      return {
        exitCode: result.exitCode,
        output: {
          plain: result.stdout,
          parsed: null, // Stop commands don't produce parsed output
        },
      };
    }

    // For no isolation, wait for process to complete and collect output
    if (isolation === 'none') {
      if (!processHandle) {
        throw new Error('Agent not started or already stopped');
      }

      // Wait for the process to exit
      const exitCode = await processHandle.waitForExit();
      const { stdout, stderr } = processHandle.getOutput();

      // Combine stdout and stderr for plain output
      const plainOutput = stdout + (stderr ? '\n' + stderr : '');

      // Try to parse JSON messages
      const parsedOutput = parseJsonMessages(plainOutput);

      // Clean up signal handler
      if (removeSignalHandler) {
        removeSignalHandler();
        removeSignalHandler = null;
      }

      return {
        exitCode,
        output: {
          plain: plainOutput,
          parsed: parsedOutput,
        },
      };
    }

    throw new Error(`Unsupported isolation mode: ${isolation}`);
  };

  return {
    start,
    stop,
  };
}

// Export other utilities if needed
export { buildAgentCommand, buildScreenStopCommand, buildDockerStopCommand } from './command-builder.mjs';
export { executeCommand, executeDetached, setupSignalHandler } from './executor.mjs';
