import { completionState, outcomeMessages } from './completion.mjs';
import { assessBackgroundTasks } from './background-tasks.mjs';
import { firstErrorText } from './error-text.mjs';
import { signalFromExitCode } from './executor.mjs';
import { extractObservedModels, isRealModelId } from './observed-models.mjs';
import { extractUsageWindows } from './usage-windows.mjs';
import { extractContextUsage } from './context-usage.mjs';
import { extractStructuredOutput } from './structured-output.mjs';
import { parseJsonRecords } from './streaming/json-records.mjs';
import {
  classifyDebugLines,
  detectUsageLimitSources,
  isRecoverableToolError,
  splitOutput,
} from './usage-limit.mjs';

function parseJsonMessages(output) {
  return parseJsonRecords(output || '').flatMap((value) =>
    Array.isArray(value) ? value : [value]
  );
}

function normalizeMessages({ parsedOutput, plainOutput, toolConfig }) {
  if (Array.isArray(parsedOutput)) {
    return parsedOutput;
  }

  if (toolConfig?.parseOutput) {
    return toolConfig.parseOutput({ output: plainOutput || '' });
  }

  return parseJsonMessages(plainOutput || '');
}

// A structured result message that reports an explicit success is authoritative.
// The raw stream-json output contains HTTP header names (e.g.
// "anthropic-ratelimit-unified-5h-reset") that can match usage-limit patterns
// even on a fully successful run, so trust this signal over the text scan when
// it is available. See issue #37.
function hasStructuredSuccess(messages, tool) {
  return completionState(tool, messages) === 'completed';
}

const NO_USAGE_LIMIT = {
  reached: false,
  throttled: false,
  resetTime: null,
  timezone: null,
  resetsAt: null,
  window: null,
};

function detectUsageLimit({ plainOutput, messages = [], tool }) {
  if (hasStructuredSuccess(messages, tool)) {
    return NO_USAGE_LIMIT;
  }
  return detectUsageLimitSources({ plainOutput: plainOutput || '', messages });
}

function textFromValue(value) {
  if (typeof value === 'string') {
    return value.trim() || null;
  }

  if (Array.isArray(value)) {
    const parts = value.map((item) => textFromValue(item)).filter(Boolean);
    return parts.length > 0 ? parts.join('\n').trim() : null;
  }

  if (value && typeof value === 'object') {
    for (const key of ['text', 'content', 'result', 'summary', 'message']) {
      const text = textFromValue(value[key]);
      if (text) {
        return text;
      }
    }
  }

  return null;
}

function extractResultSummary({ messages, plainOutput }) {
  const keys = [
    'result',
    'response',
    'summary',
    'result_summary',
    'resultSummary',
    'final_answer',
    'finalAnswer',
    'text',
    'content',
    'message',
  ];

  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    for (const key of keys) {
      const text = textFromValue(message[key]);
      if (text) {
        return text;
      }
    }

    const nestedText =
      textFromValue(message.part?.text) ||
      textFromValue(message.item?.content) ||
      textFromValue(message.item?.text) ||
      textFromValue(message.delta?.text);
    if (nestedText) {
      return nestedText;
    }
  }

  const plainText = (plainOutput || '').trim();
  return plainText ? plainText.slice(-4000) : null;
}

function firstNumber(messages, keys) {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    for (const key of keys) {
      const value = message[key];
      if (typeof value === 'number') {
        return value;
      }
    }
  }

  return null;
}

function extractResultModelUsage(messages) {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const direct =
      message.resultModelUsage ||
      message.result_model_usage ||
      message.modelUsage ||
      message.model_usage ||
      message.usage_by_model ||
      message.stats?.models;
    if (direct && typeof direct === 'object') {
      return direct;
    }
  }

  const usageByModel = {};
  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const model =
      message.model || message.message?.model || message.part?.model;
    const usage =
      message.usage || message.message?.usage || message.part?.tokens;
    if (isRealModelId(model) && usage && typeof usage === 'object') {
      usageByModel[model] = usageByModel[model] || [];
      usageByModel[model].push(usage);
    }
  }

  return Object.keys(usageByModel).length > 0 ? usageByModel : null;
}

function extractSubAgentCalls(messages) {
  const calls = [];

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const direct =
      message.subAgentCalls ||
      message.sub_agent_calls ||
      message.subAgents ||
      message.sub_agents;
    if (Array.isArray(direct)) {
      calls.push(...direct);
      continue;
    }

    for (const block of Array.isArray(message.message?.content)
      ? message.message.content
      : []) {
      if (block.type === 'tool_use' && ['Task', 'Agent'].includes(block.name)) {
        calls.push({
          type: 'tool_use',
          id: block.id || null,
          name: block.name,
          status: 'started',
          summary: block.input?.description || null,
        });
      }
    }

    const type = message.item?.type || message.item_type || message.type;
    if (typeof type === 'string' && /(?:sub[_-]?agent|collab)/i.test(type)) {
      calls.push({
        type,
        id: message.id || message.call_id || message.item?.id || null,
        name: message.name || message.tool || message.item?.name || null,
        status: message.item?.status || message.status || message.state || null,
        summary: extractResultSummary({ messages: [message], plainOutput: '' }),
      });
    }
  }

  return calls.length > 0 ? calls : null;
}

// Claude's synthetic API error message carries the error code as a string
// (`"error":"rate_limit"`) and the readable text in its content.
function apiErrorCode(messages) {
  const message = [...messages]
    .reverse()
    .find(
      (event) =>
        event?.type === 'assistant' &&
        event.is_api_error_message === true &&
        typeof event.error === 'string'
    );
  return message?.error || null;
}

function extractErrorFromMessages(messages) {
  const code = apiErrorCode(messages);
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') {
      continue;
    }
    // A failed tool call is returned to the model; it does not decide the run.
    if (isRecoverableToolError(message)) {
      continue;
    }

    const messageType = message.type || message.subtype || message.item?.type;
    if (
      message.is_error === true ||
      message.error ||
      messageType === 'error' ||
      messageType === 'step_error' ||
      messageType === 'turn.failed' ||
      message.status === 'error' ||
      message.subtype?.startsWith('error')
    ) {
      const error = message.error;
      const objectError = error && typeof error === 'object' ? error : null;
      const errorType =
        (objectError &&
          (objectError.type || objectError.code || objectError.name)) ||
        (typeof error === 'string' && error) ||
        message.errorType ||
        message.error_type ||
        (messageType === 'result' && (message.api_error || code)) ||
        messageType ||
        'execution_error';
      const errorMessage =
        (objectError && firstErrorText([objectError])) ||
        textFromValue(message.message) ||
        textFromValue(message.result) ||
        (typeof error === 'string' && error) ||
        'Execution failed';

      return { hasError: true, errorType, message: errorMessage };
    }
  }

  return { hasError: false, errorType: null, message: null };
}

const PREFERRED_EXIT_LINE = /^(?:error\b|fatal:|(?:\/\S*\/)?(?:ba|z)?sh:\s)/i;
// `2026-05-01T10:00:00.123Z DEBUG codex_core::...` tracing telemetry is not an
// exit reason (hive-mind codex.process-exit).
const TRACING_LINE =
  /^\S*?\d{4}-\d{2}-\d{2}T[\d:.]+Z\s+(?:TRACE|DEBUG|INFO|WARN|ERROR)\s/;

// The reason a process exited is a plain text line: JSON records, the
// ANTHROPIC_LOG=debug dump and its base64 bodies are not (hive-mind#3570).
function exitReasonLine(plainOutput) {
  const { lines } = splitOutput(plainOutput);
  const { debugLines } = classifyDebugLines(lines);
  const candidates = lines
    .filter((_, index) => !debugLines.has(index))
    .map((line) => line.trim())
    .filter((line) => line && !TRACING_LINE.test(line));
  return (
    candidates.findLast((line) => PREFERRED_EXIT_LINE.test(line)) ||
    candidates.at(-1) ||
    null
  );
}

function exitCodeError({ exitCode, signal, plainOutput }) {
  const reason = exitReasonLine(plainOutput || '');
  if (!signal) {
    return {
      hasError: true,
      errorType: 'exit_code',
      message: reason || `Process exited with code ${exitCode}`,
    };
  }
  // A signal is the cause; a preferred error line may still say why it came.
  const preferred = reason && PREFERRED_EXIT_LINE.test(reason) ? reason : null;
  return {
    hasError: true,
    errorType: 'signal',
    message: `Process exited with code ${exitCode} (${signal})${preferred ? `: ${preferred}` : ''}`,
  };
}

function detectExecutionError({
  exitCode,
  signal,
  plainOutput,
  messages,
  toolConfig,
}) {
  if (toolConfig?.detectErrors) {
    const detected = toolConfig.detectErrors({
      output: messages.map((message) => JSON.stringify(message)).join('\n'),
    });
    if (detected?.hasError) {
      return {
        hasError: true,
        errorType: detected.errorType || 'execution_error',
        message: detected.message || 'Execution failed',
      };
    }
  }

  const messageError = extractErrorFromMessages(messages);
  if (messageError.hasError) {
    return messageError;
  }

  if (exitCode !== 0) {
    return (
      (!signal && errorRecordInOutput(plainOutput)) ||
      exitCodeError({ exitCode, signal, plainOutput })
    );
  }

  return { hasError: false, errorType: null, message: null };
}

// A process that failed without an error event on stdout may have written it
// to stderr: Agent prints its fatal errors there (agent src/cli/output.ts
// outputError; hive-mind agent.lib.mjs scans both streams). Only explains a
// failed exit, so diagnostics cannot fail a successful run.
function errorRecordInOutput(plainOutput) {
  const records = parseJsonMessages(plainOutput).filter(
    (record) => record?.type === 'error'
  );
  const error = extractErrorFromMessages(records);
  return error.hasError ? error : null;
}

// Claude's API failure details, passed through for callers that log or
// classify them (hive-mind feca4bcfb: errorCode, api_error_status, terminal_reason).
function extractApiErrorDetails(messages) {
  const result = [...messages]
    .reverse()
    .find((event) => event?.type === 'result');
  const apiMessage = [...messages]
    .reverse()
    .find(
      (event) =>
        event?.type === 'assistant' && event.is_api_error_message === true
    );
  const stringError = (event) =>
    typeof event?.error === 'string' ? event.error : null;
  return {
    apiError:
      result?.api_error ??
      stringError(result) ??
      stringError(apiMessage) ??
      null,
    apiErrorStatus: result?.api_error_status ?? null,
    terminalReason: result?.terminal_reason ?? null,
    requestId: result?.request_id ?? apiMessage?.request_id ?? null,
  };
}

function extractSessionId({ explicitSessionId, messages }) {
  if (explicitSessionId) {
    return explicitSessionId;
  }

  for (const message of messages) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const sessionId =
      message.session_id ||
      message.sessionId ||
      message.sessionID ||
      message.thread_id ||
      message.threadId ||
      message.conversation_id ||
      message.conversationId;
    if (sessionId) {
      return sessionId;
    }
  }

  return null;
}

function publicPricingEstimate({ tool, usage }) {
  if (!usage || typeof usage !== 'object') {
    return null;
  }

  const cost =
    typeof usage.totalCost === 'number'
      ? usage.totalCost
      : typeof usage.totalCostUSD === 'number'
        ? usage.totalCostUSD
        : null;
  if (cost === null) {
    return null;
  }

  return tool === 'agent' || tool === 'opencode' ? cost : null;
}

/**
 * Build stable, caller-facing metadata from tool-specific agent output.
 * @param {Object} options - Metadata inputs
 * @param {string} options.tool - Tool name
 * @param {number} options.exitCode - Process exit code
 * @param {string} [options.plainOutput] - Raw process output
 * @param {Object[]|null} [options.parsedOutput] - Parsed stream messages
 * @param {string|null} [options.sessionId] - Extracted session ID
 * @param {Object|null} [options.usage] - Aggregated stream token usage
 * @param {Object|null} [options.toolConfig] - Tool parser configuration
 * @param {string|null} [options.signal] - Signal that ended the process;
 *   inferred from an exit code above 128 when omitted
 * @param {boolean} [options.terminatedAfterResult] - The caller stopped the
 *   process after its result arrived
 * @param {boolean} [options.structuredOutputRequested] - A `jsonSchema` was
 *   passed, so Codex's final message is read as JSON
 * @returns {Object} Normalized result metadata
 */
export function buildNormalizedResultMetadata(options) {
  const {
    tool,
    exitCode,
    plainOutput = '',
    parsedOutput = null,
    sessionId = null,
    usage = null,
    toolConfig = null,
    terminatedAfterResult = false,
    structuredOutputRequested = false,
  } = options;
  const signal = options.signal ?? signalFromExitCode(exitCode);
  const allMessages = normalizeMessages({
    parsedOutput,
    plainOutput,
    toolConfig,
  });
  const messages = allMessages.filter((event) => !event?.parent_tool_use_id);
  const usageLimit = detectUsageLimit({ plainOutput, messages, tool });
  const completed = completionState(tool, messages) === 'completed';
  // Stopping a process after its completed result is the caller's own
  // signal, not the tool's verdict (hive-mind#3015 interpretClaudeExitCode).
  const exitForgiven = terminatedAfterResult && completed;
  const error = detectExecutionError({
    exitCode: exitForgiven ? 0 : exitCode,
    signal,
    plainOutput,
    messages: outcomeMessages(tool, messages),
    toolConfig,
  });
  if (!error.hasError && completionState(tool, messages) === 'incomplete') {
    Object.assign(error, {
      hasError: true,
      errorType: 'incomplete_stream',
      message: 'Process exited before the native completion event',
    });
  }
  const background = assessBackgroundTasks({
    messages: allMessages,
    output: plainOutput,
    terminatedAfterResult,
  });
  if (!error.hasError && background.incomplete) {
    Object.assign(error, {
      hasError: true,
      errorType: 'background_tasks_stopped',
      message: background.cause,
    });
  }
  // A server-side throttle is transient: callers retry instead of waiting for a reset.
  if (error.hasError && usageLimit.throttled) {
    error.errorType = 'rate_limited';
  }
  const anthropicTotalCostUSD = firstNumber(messages, [
    'total_cost_usd',
    'totalCostUsd',
    'anthropicTotalCostUSD',
  ]);
  const estimate = publicPricingEstimate({ tool, usage });

  return {
    tool,
    exitCode,
    signal,
    success:
      (exitCode === 0 || exitForgiven) &&
      !usageLimit.reached &&
      !error.hasError,
    terminatedAfterResult: Boolean(terminatedAfterResult),
    sessionId: extractSessionId({
      explicitSessionId: sessionId,
      messages,
    }),
    limitReached: usageLimit.reached,
    limitResetTime: usageLimit.resetTime,
    limitTimezone: usageLimit.timezone,
    limitResetsAt: usageLimit.resetsAt,
    limitWindow: usageLimit.window,
    usageWindows: extractUsageWindows(messages),
    contextUsage: extractContextUsage(allMessages),
    anthropicTotalCostUSD,
    publicPricingEstimate: estimate,
    pricingInfo:
      estimate === null
        ? null
        : {
            totalCostUSD: estimate,
            source: `${tool}-stream-usage`,
          },
    resultSummary: extractResultSummary({ messages, plainOutput }),
    structuredOutput: extractStructuredOutput({
      tool,
      messages,
      plainOutput,
      requested: structuredOutputRequested,
    }),
    resultModelUsage: extractResultModelUsage(messages),
    ...extractObservedModels(allMessages),
    streamTokenUsage: usage,
    subAgentCalls: extractSubAgentCalls(allMessages),
    errorDuringExecution: error.hasError,
    errorType: error.errorType,
    errorMessage: error.message,
    ...extractApiErrorDetails(messages),
    runningBackgroundTasks: background.runningBackgroundTasks,
    backgroundTasksStopped: background.backgroundTasksStopped,
    stoppedBackgroundTasks: background.stoppedBackgroundTasks,
    printWaitCeilingSeconds: background.printWaitCeilingSeconds,
  };
}
