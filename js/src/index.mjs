/**
 * Agent Commander - Main library interface
 * A JavaScript library to control agents enclosed in CLI commands
 *
 * Supports multiple CLI agents:
 * - claude: Anthropic Claude Code CLI
 * - codex: OpenAI Codex CLI
 * - opencode: OpenCode CLI
 * - agent: @link-assistant/agent (OpenCode fork with native permission modes)
 * - qwen: Qwen Code CLI
 * - gemini: Gemini CLI
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
import { normalizeExtraEnv } from './tools/shell.mjs';
import { definedLaunchOptions } from './tools/launch-options.mjs';
import { createOutputStream, createInputStream } from './streaming/index.mjs';
import { stringifyNdjsonLine } from './streaming/ndjson.mjs';
import { parseJsonRecords } from './streaming/json-records.mjs';
import { buildNormalizedResultMetadata } from './result-metadata.mjs';
import {
  applyCodexRolloutUsageLimit,
  applyCodexRolloutUsageWindows,
} from './codex-rollout.mjs';
import { applyClaudeTranscriptUsageLimit } from './claude-transcript.mjs';
import { requireCompletedResult } from './completion.mjs';
import {
  createStdoutMessageReader,
  hasFinalResult,
  waitForExitAfterResult,
} from './result-close.mjs';
import { PermissionRelay, askUnsupportedError } from './permissions/index.mjs';
import {
  buildInterruptFrame,
  buildUserInputFrame,
  liveInputUnsupportedError,
  supportsLiveInput,
} from './live-input.mjs';

const PROMPT_FILE_TOOLS = new Set([
  'claude',
  'codex',
  'opencode',
  'agent',
  'qwen',
  'gemini',
]);

/**
 * Determine whether the tool can read prompt input from stdin.
 * @param {string} toolName - Tool name
 * @returns {boolean} True when prompt files can be piped into the tool
 */
function supportsPromptFileInput(toolName) {
  return PROMPT_FILE_TOOLS.has(toolName);
}

/**
 * Build the prompt content to write to a temporary stdin file.
 * @param {Object} options - Options
 * @param {string} options.toolName - Tool name
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @returns {string} Prompt file content
 */
function buildPromptFileContent(options) {
  const { toolName, prompt, systemPrompt } = options;

  if (toolName === 'claude') {
    return prompt || '';
  }

  return systemPrompt ? `${systemPrompt}\n\n${prompt || ''}` : prompt || '';
}

/**
 * Return true when a temporary prompt file should replace inline shell input.
 * @param {Object} options - Options
 * @param {string} options.toolName - Tool name
 * @param {string} [options.prompt] - User prompt
 * @param {string} [options.systemPrompt] - System prompt
 * @param {string} [options.promptFile] - Existing prompt file
 * @param {boolean} [options.dryRun] - Dry-run mode
 * @returns {boolean} True when a temporary prompt file should be created
 */
function shouldCreatePromptFile(options) {
  const { toolName, prompt, systemPrompt, promptFile, dryRun } = options;

  if (dryRun || promptFile || !supportsPromptFileInput(toolName)) {
    return false;
  }

  if (toolName === 'claude') {
    return Boolean(prompt);
  }

  return Boolean(prompt || systemPrompt);
}

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

  // Default parsing logic: NDJSON, pretty-printed, or concatenated records
  const messages = parseJsonRecords(output).flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
  return messages.length > 0 ? messages : null;
}

/**
 * Create an agent controller
 * @param {Object} options - Agent configuration
 * @param {string} options.tool - CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'agent', 'qwen', 'gemini')
 * @param {string} options.workingDirectory - Working directory for the agent
 * @param {string} [options.prompt] - Prompt for the agent
 * @param {string} [options.promptFile] - File containing prompt input for stdin-based tools
 * @param {string} [options.systemPrompt] - System prompt for the agent
 * @param {string} [options.model] - Model to use (tool-specific)
 * @param {string} [options.isolation='none'] - Isolation mode: 'none', 'screen', 'docker'
 * @param {string} [options.screenName] - Screen session name (for screen isolation)
 * @param {string} [options.containerName] - Container name (for docker isolation)
 * @param {boolean} [options.json=false] - Enable JSON output mode
 * @param {string} [options.resume] - Resume a previous session (tool-specific)
 * @param {boolean} [options.readOnly=false] - Enforce native read-only/planning mode
 * @param {boolean} [options.planOnly=false] - Enforce native planning mode (where the tool distinguishes it)
 * @param {boolean} [options.approveEach=false] - Enforce per-command approval (ask mode)
 * @param {Function} [options.onPermissionRequest] - async (normalizedRequest) => 'once'|'always'|'reject';
 *   when provided together with approveEach for a relay-capable tool, native permission requests are
 *   normalized, relayed to this callback, and the decision is forwarded to the tool's stdin
 * @param {string} [options.reasoningEffort] - Native reasoning effort / variant level
 * @param {string|Object} [options.mcpConfig] - MCP servers: config path, inline JSON or `{mcpServers}` object
 * @param {boolean} [options.strictMcpConfig=false] - Use only the servers from `mcpConfig`
 * @param {string|string[]} [options.additionalDirectories] - Extra directories the agent may access
 * @param {boolean} [options.liveInput=false] - Keep stdin open as a stream-json channel so
 *   `sendMessage()` / `interrupt()` can reach the running session (claude, agent)
 * @param {Object} [options.toolOptions] - Additional tool-specific options
 * @returns {Object} Agent controller with start, stop, and utility methods
 */
export function agent(options) {
  const {
    tool,
    workingDirectory,
    prompt,
    promptFile,
    systemPrompt,
    model,
    isolation = 'none',
    screenName,
    containerName,
    json = false,
    resume,
    readOnly = false,
    planOnly = false,
    approveEach = false,
    onPermissionRequest,
    reasoningEffort,
    mcpConfig,
    strictMcpConfig = false,
    additionalDirectories,
    liveInput = false,
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

  // Live per-command approval relay is active only when ask mode is requested,
  // a decision callback is supplied, and the tool exposes a relayable protocol.
  const relayActive = Boolean(
    approveEach &&
    typeof onPermissionRequest === 'function' &&
    toolConfig &&
    toolConfig.supportsAsk
  );

  // Both the relay and live input write NDJSON frames to the child's stdin.
  const streamingInput = relayActive || liveInput;

  let processHandle = null;
  let inputOpen = false;
  let messagesAtLastInput = 0;
  let removeSignalHandler = null;
  let command = null;
  let outputStream = null;
  let permissionRelay = null;
  let sessionId = null;
  let promptTempDir = null;

  const cleanupPromptTempDir = async () => {
    if (!promptTempDir) {
      return;
    }

    const dir = promptTempDir;
    promptTempDir = null;
    await rm(dir, { recursive: true, force: true });
  };

  const preparePromptFile = async (startOptions) => {
    if (
      !shouldCreatePromptFile({
        toolName: tool,
        prompt,
        systemPrompt,
        promptFile,
        dryRun: startOptions.dryRun,
      })
    ) {
      return promptFile;
    }

    promptTempDir = await mkdtemp(join(tmpdir(), 'agent-commander-'));
    const tempPromptFile = join(promptTempDir, 'prompt.txt');
    await writeFile(
      tempPromptFile,
      buildPromptFileContent({ toolName: tool, prompt, systemPrompt }),
      { mode: 0o600 }
    );
    return tempPromptFile;
  };

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

    // Fail clearly (before any filesystem side effects such as writing the
    // temporary prompt file) when ask mode is requested for a tool that has no
    // drivable per-command approval protocol — same pattern as `--read-only`.
    if (approveEach && !(toolConfig && toolConfig.supportsAsk)) {
      throw new Error(askUnsupportedError({ tool }));
    }
    if (liveInput && !supportsLiveInput(toolConfig)) {
      throw new Error(liveInputUnsupportedError({ tool }));
    }
    if (liveInput && !dryRun && (detached || isolation !== 'none')) {
      throw new Error(
        'liveInput needs an attached run without isolation (stdin is piped to the tool).'
      );
    }

    // Create output stream for JSON parsing if in JSON mode, callbacks are
    // provided, or a live permission relay is active (the relay inspects every
    // parsed message looking for native permission requests).
    if (json || onMessage || streamingInput) {
      outputStream = createOutputStream({
        onMessage: (data) => {
          if (onMessage) {
            onMessage(data.message);
          }
          if (permissionRelay) {
            // Relay native permission requests to the consumer and forward the
            // decision to the tool's stdin. Errors must not break the stream.
            Promise.resolve(
              permissionRelay.handleMessage({ message: data.message })
            ).catch(() => {});
          }
        },
      });
    }

    try {
      // In relay mode the prompt is delivered as the initial NDJSON user frame
      // over stdin, so no temporary prompt file is created or piped.
      const preparedPromptFile = streamingInput
        ? undefined
        : await preparePromptFile({ dryRun });
      const promptHandledByTempFile = preparedPromptFile && !promptFile;

      // Build the command with tool-specific options
      const commandOptions = {
        tool,
        workingDirectory,
        prompt: promptHandledByTempFile ? undefined : prompt,
        promptFile: preparedPromptFile,
        systemPrompt:
          promptHandledByTempFile && tool !== 'claude'
            ? undefined
            : systemPrompt,
        isolation,
        screenName,
        containerName,
        detached,
        readOnly,
        planOnly,
        approveEach,
      };

      // Add tool-specific options if tool is known
      if (toolConfig) {
        commandOptions.model = model;
        commandOptions.json = json;
        commandOptions.resume = resume;
        Object.assign(
          commandOptions,
          definedLaunchOptions({
            reasoningEffort,
            mcpConfig,
            strictMcpConfig,
            additionalDirectories,
          }),
          toolOptions
        );
      }

      // When relaying per-command approvals or accepting live input, force a
      // streaming JSON channel in both directions: the tool emits events (and
      // permission requests) on stdout and reads the prompt, follow-up
      // messages and decisions as NDJSON frames on stdin.
      if (streamingInput) {
        commandOptions.json = true;
        commandOptions.jsonInput = true;
        commandOptions.streamInput = true;
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
          processHandle?.terminate();
          if (processHandle?.waitForExit) {
            await processHandle.waitForExit();
          }
          await cleanupPromptTempDir();
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
        const commandOptions = { attached, pipeStdin: streamingInput };

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

        // Establish the live permission relay: it writes normalized decisions
        // to the child's stdin as NDJSON frames.
        if (relayActive) {
          permissionRelay = new PermissionRelay({
            tool,
            onRequest: onPermissionRequest,
            write: (line) => processHandle.writeStdin(line),
          });
        }

        // Kick off the turn by sending the user prompt as the first frame.
        if (streamingInput) {
          inputOpen = true;
          writeInputFrame(
            buildUserInputFrame({ tool, content: prompt, systemPrompt })
          );
        }
      }
    } catch (error) {
      await cleanupPromptTempDir();
      throw error;
    }
  };

  const writeInputFrame = (frame) => {
    if (!inputOpen || !processHandle?.writeStdin) {
      throw new Error(
        liveInput || relayActive
          ? 'Agent input is closed (not started, ended, or stopped)'
          : 'Agent was not started with liveInput'
      );
    }
    messagesAtLastInput = currentMessages().length;
    return processHandle.writeStdin(stringifyNdjsonLine({ value: frame }));
  };

  /**
   * Queue a follow-up user message into the running session. The tool reads
   * it after (or, for Claude, alongside) the current turn.
   * @param {string|Object[]} content - Text, or content blocks for Claude
   * @returns {boolean} True when the frame was written
   */
  const sendMessage = (content) =>
    writeInputFrame(buildUserInputFrame({ tool, content }));

  /**
   * Ask Claude to end the running turn; queued messages still run.
   * @returns {boolean} True when the frame was written
   */
  const interrupt = () => writeInputFrame(buildInterruptFrame({ tool }));

  /**
   * Close stdin: the tool finishes the queued input and exits.
   */
  const endInput = () => {
    if (inputOpen) {
      inputOpen = false;
      processHandle?.endStdin?.();
    }
  };

  // A relay still has to answer permission requests of the last turn, so it
  // keeps stdin open until that turn reports its final result.
  const endInputAfterLastTurn = async () => {
    if (!inputOpen) {
      return;
    }
    if (relayActive) {
      while (
        processHandle.getOutput?.().hasExited !== true &&
        !hasFinalResult(tool, currentMessages().slice(messagesAtLastInput))
      ) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }
    endInput();
  };

  /**
   * Stop the agent and collect output
   * @param {Object} [stopOptions] - Stop options
   * @param {boolean} [stopOptions.dryRun] - If true, just show the command
   * @param {number} [stopOptions.closeTimeoutMs] - Stop a process that stays
   *   this long after its final result (no isolation only); waits forever
   *   when omitted
   * @param {number} [stopOptions.backgroundWaitMs] - Extra time granted while
   *   Claude background tasks still run; leaves them to Claude's own print
   *   wait ceiling when omitted
   * @returns {Promise<Object>} Result with exitCode, output, session info, usage, and metadata
   */
  const stop = async (stopOptions = {}) => {
    const { dryRun = false, closeTimeoutMs, backgroundWaitMs } = stopOptions;

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
        return {
          exitCode: 0,
          output: { plain: '', parsed: null },
          metadata: buildNormalizedResultMetadata({
            tool,
            exitCode: 0,
            plainOutput: '',
            parsedOutput: null,
            sessionId: null,
            usage: null,
            toolConfig,
          }),
        };
      }

      try {
        const result = await executeCommand(stopCommand, {
          dryRun,
          attached: true,
        });
        const metadata = buildNormalizedResultMetadata({
          tool,
          exitCode: result.exitCode,
          plainOutput: result.stdout,
          parsedOutput: null,
          sessionId: null,
          usage: null,
          toolConfig,
        });
        return {
          exitCode: result.exitCode,
          output: {
            plain: result.stdout,
            parsed: null, // Stop commands don't produce parsed output
          },
          metadata,
        };
      } finally {
        await cleanupPromptTempDir();
      }
    }

    // For no isolation, wait for process to complete and collect output
    if (isolation === 'none') {
      if (!processHandle) {
        throw new Error('Agent not started or already stopped');
      }

      try {
        await endInputAfterLastTurn();
        // Wait for the process to exit, closing it when it outlives its result
        const waited = await waitForExitAfterResult({
          tool,
          waitForExit: () => processHandle.waitForExit(),
          terminate: () => processHandle.terminate(),
          readMessages: currentMessages,
          closeTimeoutMs,
          backgroundWaitMs,
        });
        const exitCode = waited.exitCode;
        const terminatedAfterResult =
          stopOptions.terminatedAfterResult === true ||
          waited.terminatedAfterResult;
        const { stdout, stderr, signal } = processHandle.getOutput();

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
            output: stdout,
            toolName: tool,
          });
        }

        // Extract session ID if tool supports it
        if (toolConfig && toolConfig.extractSessionId) {
          sessionId = toolConfig.extractSessionId({ output: stdout });
        }

        // Extract usage if tool supports it
        let usage = null;
        if (toolConfig && toolConfig.extractUsage) {
          usage = toolConfig.extractUsage({ output: stdout });
        }

        // Clean up signal handler
        if (removeSignalHandler) {
          removeSignalHandler();
          removeSignalHandler = null;
        }

        const metadata = buildNormalizedResultMetadata({
          tool,
          exitCode,
          signal,
          plainOutput,
          parsedOutput,
          sessionId,
          usage,
          toolConfig,
          terminatedAfterResult,
        });
        // Codex and Claude can leave a usage limit only in their session
        // files (hive-mind#3570)
        const runEnv = normalizeExtraEnv(toolOptions.extraEnv);
        const codexHome = runEnv.findLast(([name]) => name === 'CODEX_HOME');
        const rolloutOptions = codexHome ? { codexHome: codexHome[1] } : {};
        await applyCodexRolloutUsageLimit(metadata, rolloutOptions);
        await applyCodexRolloutUsageWindows(metadata, rolloutOptions);
        if ((json || tool === 'agent') && toolConfig) {
          requireCompletedResult(metadata, tool, parsedOutput || []);
        }
        const claudeConfigDir = runEnv.findLast(
          ([name]) => name === 'CLAUDE_CONFIG_DIR'
        );
        await applyClaudeTranscriptUsageLimit(metadata, {
          workingDirectory,
          ...(claudeConfigDir ? { claudeConfigDir: claudeConfigDir[1] } : {}),
        });

        return {
          exitCode,
          output: {
            plain: plainOutput,
            parsed: parsedOutput,
          },
          sessionId,
          usage,
          metadata,
        };
      } finally {
        removeSignalHandler?.();
        removeSignalHandler = null;
        await cleanupPromptTempDir();
      }
    }

    throw new Error(`Unsupported isolation mode: ${isolation}`);
  };

  /**
   * Get the current session ID (if available)
   * @returns {string|null} Session ID or null
   */
  const getSessionId = () => sessionId;

  let readStdoutMessages = null;
  // Events seen so far, from the output stream or from the raw stdout
  const currentMessages = () => {
    if (outputStream) {
      return outputStream.getMessages();
    }
    if (!processHandle?.getOutput) {
      return [];
    }
    readStdoutMessages ??= createStdoutMessageReader(
      () => processHandle.getOutput().stdout
    );
    return readStdoutMessages();
  };

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

  /**
   * Stop the agent now and collect output. A process stopped after its final
   * result is still judged by that result.
   * @returns {Promise<Object>} Same result as stop()
   */
  const cancel = async () => {
    let terminatedAfterResult = false;
    if (isolation === 'none' && processHandle) {
      terminatedAfterResult =
        processHandle.getOutput?.().hasExited !== true &&
        hasFinalResult(tool, currentMessages());
      endInput();
      processHandle.terminate?.();
    }
    return stop({ terminatedAfterResult });
  };

  return {
    start,
    stop,
    cancel,
    sendMessage,
    interrupt,
    endInput,
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
  DEFAULT_KILL_AFTER_MS,
  DEFAULT_PIPE_DRAIN_MS,
  executeCommand,
  executeDetached,
  isProcessGroupAlive,
  normalizeExit,
  setupSignalHandler,
  signalFromExitCode,
  startCommand,
} from './executor.mjs';
export {
  PRINT_BG_CEILING_PATTERN,
  assessBackgroundTasks,
  printWaitCeilingSeconds,
  trackBackgroundTasks,
} from './background-tasks.mjs';
export { extractObservedModels, isRealModelId } from './observed-models.mjs';
export {
  CODEX_SESSIONS_DIRNAME,
  ROLLOUT_TAIL_BYTES,
  applyCodexRolloutUsageLimit,
  applyCodexRolloutUsageWindows,
  canResumeCodexSession,
  classifyCodexRateLimitSnapshot,
  codexRolloutLimitFacts,
  codexSessionsDir,
  detectCodexRolloutUsageLimit,
  findCodexRolloutFile,
  isCodexRolloutFileName,
  readCodexRolloutLimitFacts,
} from './codex-rollout.mjs';
export {
  TRANSCRIPT_TAIL_BYTES,
  applyClaudeTranscriptUsageLimit,
  claudeProjectSlugs,
  claudeTranscriptApiError,
  claudeTranscriptCandidates,
  readClaudeTranscriptApiError,
} from './claude-transcript.mjs';
export {
  DEFAULT_RESULT_POLL_MS,
  createStdoutMessageReader,
  hasFinalResult,
  waitForExitAfterResult,
} from './result-close.mjs';
export { tools, getTool, listTools, isToolSupported } from './tools/index.mjs';
export { JsonOutputStream, JsonInputStream } from './streaming/index.mjs';
export { parseNdjsonLine, stringifyNdjsonLine } from './streaming/ndjson.mjs';
export {
  createJsonRecordScanner,
  parseJsonRecords,
} from './streaming/json-records.mjs';
export { buildNormalizedResultMetadata } from './result-metadata.mjs';
export {
  USAGE_WINDOW_KINDS,
  claudeRateLimitWindows,
  codexRateLimitWindows,
  extractUsageWindows,
  mergeUsageWindows,
  usageWindowsFromMessage,
} from './usage-windows.mjs';
export {
  buildInterruptFrame,
  buildUserInputFrame,
  liveInputUnsupportedError,
  supportsLiveInput,
} from './live-input.mjs';
export {
  USAGE_LIMIT_PATTERNS,
  classifyDebugLines,
  classifyRateLimitEvent,
  detectUsageLimitSources,
  extractResetTime,
  extractTimezone,
  formatEpochResetTimeUtc,
  isRecoverableToolError,
  isUsageLimitText,
  limitScanText,
} from './usage-limit.mjs';
export { firstErrorText, stringifyErrorValue } from './error-text.mjs';
export {
  buildVersionCommand,
  compareVersions,
  getToolVersion,
  parseToolVersion,
  toolVersionFromOutput,
} from './tool-version.mjs';
export {
  assertLaunchOptionsSupported,
  codexMcpServersOverride,
  definedLaunchOptions,
  getLaunchCapabilities,
  mcpConfigArg,
  mcpServersFromConfig,
  normalizeAdditionalDirectories,
  normalizeReasoningEffort,
  toTomlValue,
} from './tools/launch-options.mjs';
export {
  buildAgentTuiLaunch,
  captureAgentTui,
  normalizeTuiTranscript,
} from './tui.mjs';
export {
  ASK_SUPPORTED_TOOLS,
  ASK_DECISIONS,
  ASK_SCOPE,
  PERMISSION_PARITY,
  supportsAsk,
  askUnsupportedError,
  normalizePermissionRequest,
  buildPermissionResponse,
  PermissionRelay,
  createPermissionRelay,
} from './permissions/index.mjs';
