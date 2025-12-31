/**
 * Agent Commander - Main library interface
 * A JavaScript library to control agents enclosed in CLI commands
 *
 * Supports multiple CLI agents:
 * - claude: Anthropic Claude Code CLI
 * - codex: OpenAI Codex CLI
 * - opencode: OpenCode CLI
 * - agent: @link-assistant/agent (unrestricted OpenCode fork)
 */

import {
  buildAgentCommand,
  buildScreenStopCommand,
  buildDockerStopCommand,
} from './command-builder.mjs';
import {
  executeCommand,
  executeDetached,
  setupSignalHandler,
  startCommand,
} from './executor.mjs';
import { getTool, isToolSupported } from './tools/index.mjs';
import { createOutputStream, createInputStream } from './streaming/index.mjs';

/**
 * Parse JSON messages from output if the tool supports it
 * @param {Object} options - Options
 * @param {string} options.output - Raw output to parse
 * @param {string} [options.toolName] - Tool name for tool-specific parsing
 * @returns {Array|null} Array of parsed JSON messages or null if parsing fails
 */
function parseJsonMessages(options) {
  const { output, toolName } = options;

  // If we have a tool-specific parser, use it
  if (toolName && isToolSupported({ toolName })) {
    const tool = getTool({ toolName });
    if (tool.parseOutput) {
      return tool.parseOutput({ output });
    }
  }

  // Default parsing logic
  try {
    // Try to parse as JSON array
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    // If single object, wrap in array
    return [parsed];
  } catch {
    // Try to extract JSON objects line by line (NDJSON)
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
 * @param {string} options.tool - CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'agent')
 * @param {string} options.workingDirectory - Working directory for the agent
 * @param {string} [options.prompt] - Prompt for the agent
 * @param {string} [options.systemPrompt] - System prompt for the agent
 * @param {string} [options.model] - Model to use (tool-specific)
 * @param {string} [options.isolation='none'] - Isolation mode: 'none', 'screen', 'docker'
 * @param {string} [options.screenName] - Screen session name (for screen isolation)
 * @param {string} [options.containerName] - Container name (for docker isolation)
 * @param {boolean} [options.json=false] - Enable JSON output mode
 * @param {string} [options.resume] - Resume a previous session (tool-specific)
 * @param {Object} [options.toolOptions] - Additional tool-specific options
 * @returns {Object} Agent controller with start, stop, and utility methods
 */
export function agent(options) {
  const {
    tool,
    workingDirectory,
    prompt,
    systemPrompt,
    model,
    isolation = 'none',
    screenName,
    containerName,
    json = false,
    resume,
    toolOptions = {},
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

  // Get tool configuration if available
  const toolConfig = isToolSupported({ toolName: tool })
    ? getTool({ toolName: tool })
    : null;

  let processHandle = null;
  let removeSignalHandler = null;
  let command = null;
  let outputStream = null;
  let sessionId = null;

  /**
   * Start the agent (non-blocking)
   * @param {Object} [startOptions] - Start options
   * @param {boolean} [startOptions.dryRun] - If true, just show the command
   * @param {boolean} [startOptions.detached] - Run in detached mode
   * @param {boolean} [startOptions.attached=true] - Stream output to console
   * @param {Function} [startOptions.onMessage] - Callback for JSON messages (streaming)
   * @param {Function} [startOptions.onOutput] - Callback for raw output chunks
   * @returns {Promise<void>} Resolves when process is started (not when it exits)
   */
  const start = async (startOptions = {}) => {
    const {
      dryRun = false,
      detached = false,
      attached = true,
      onMessage,
      onOutput,
    } = startOptions;

    // Create output stream for JSON parsing if in JSON mode or callbacks provided
    if (json || onMessage) {
      outputStream = createOutputStream({
        onMessage: onMessage ? (data) => onMessage(data.message) : undefined,
      });
    }

    // Build the command with tool-specific options
    const commandOptions = {
      tool,
      workingDirectory,
      prompt,
      systemPrompt,
      isolation,
      screenName,
      containerName,
      detached,
    };

    // Add tool-specific options if tool is known
    if (toolConfig) {
      commandOptions.model = model;
      commandOptions.json = json;
      commandOptions.resume = resume;
      Object.assign(commandOptions, toolOptions);
    }

    command = buildAgentCommand(commandOptions);

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
      const commandOptions = { attached };

      // Add output handling for streaming
      if (onOutput) {
        commandOptions.onStdout = (chunk) => {
          onOutput({ type: 'stdout', data: chunk });
          if (outputStream) {
            outputStream.process({ chunk });
          }
        };
        commandOptions.onStderr = (chunk) => {
          onOutput({ type: 'stderr', data: chunk });
        };
      } else if (outputStream) {
        commandOptions.onStdout = (chunk) => {
          outputStream.process({ chunk });
        };
      }

      processHandle = await startCommand(command, commandOptions);
    }
  };

  /**
   * Stop the agent and collect output
   * @param {Object} [stopOptions] - Stop options
   * @param {boolean} [stopOptions.dryRun] - If true, just show the command
   * @returns {Promise<Object>} Result with exitCode, output.plain, output.parsed, and session info
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

      const result = await executeCommand(stopCommand, {
        dryRun,
        attached: true,
      });
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
      const plainOutput = stdout + (stderr ? `\n${stderr}` : '');

      // Flush output stream if we have one
      if (outputStream) {
        outputStream.flush();
      }

      // Try to parse JSON messages (use output stream messages if available, otherwise parse)
      let parsedOutput;
      if (outputStream && outputStream.getMessages().length > 0) {
        parsedOutput = outputStream.getMessages();
      } else {
        parsedOutput = parseJsonMessages({
          output: plainOutput,
          toolName: tool,
        });
      }

      // Extract session ID if tool supports it
      if (toolConfig && toolConfig.extractSessionId) {
        sessionId = toolConfig.extractSessionId({ output: plainOutput });
      }

      // Extract usage if tool supports it
      let usage = null;
      if (toolConfig && toolConfig.extractUsage) {
        usage = toolConfig.extractUsage({ output: plainOutput });
      }

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
        sessionId,
        usage,
      };
    }

    throw new Error(`Unsupported isolation mode: ${isolation}`);
  };

  /**
   * Get the current session ID (if available)
   * @returns {string|null} Session ID or null
   */
  const getSessionId = () => sessionId;

  /**
   * Get all collected messages from the output stream
   * @returns {Object[]} Array of parsed messages
   */
  const getMessages = () => {
    if (outputStream) {
      return outputStream.getMessages();
    }
    return [];
  };

  /**
   * Get tool configuration
   * @returns {Object|null} Tool configuration or null
   */
  const getToolConfig = () => toolConfig;

  return {
    start,
    stop,
    getSessionId,
    getMessages,
    getToolConfig,
  };
}

/**
 * Create a new JSON input stream for sending messages to an agent
 * @param {Object} [options] - Options
 * @param {boolean} [options.compact=true] - Use compact JSON
 * @returns {JsonInputStream} Input stream
 */
export function createJsonInputStream(options = {}) {
  return createInputStream(options);
}

/**
 * Create a new JSON output stream for parsing agent output
 * @param {Object} [options] - Options
 * @param {Function} [options.onMessage] - Callback for each message
 * @param {Function} [options.onError] - Callback for parse errors
 * @returns {JsonOutputStream} Output stream
 */
export function createJsonOutputStream(options = {}) {
  return createOutputStream(options);
}

// Export other utilities
export {
  buildAgentCommand,
  buildScreenStopCommand,
  buildDockerStopCommand,
} from './command-builder.mjs';
export {
  executeCommand,
  executeDetached,
  setupSignalHandler,
} from './executor.mjs';
export { tools, getTool, listTools, isToolSupported } from './tools/index.mjs';
export { JsonOutputStream, JsonInputStream } from './streaming/index.mjs';
export { parseNdjsonLine, stringifyNdjsonLine } from './streaming/ndjson.mjs';
