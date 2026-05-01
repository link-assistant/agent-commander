const USAGE_LIMIT_PATTERNS = [
  /usage limit (?:reached|exceeded)/i,
  /rate[_\s-]?limit(?:ed| reached| exceeded)?/i,
  /limit reached/i,
  /billing hard limit/i,
  /please try again at/i,
  /available again at/i,
  /session limit reached/i,
  /weekly limit reached/i,
  /daily limit reached/i,
  /monthly limit reached/i,
  /freeusagelimiterror/i,
  /resets\s+(?:(?:at\s+)?[0-9]|month)/i,
];

const RESET_TIME_PATTERNS = [
  /(?:resets?|reset|try again|available again|available)\s+(?:at|on)?\s*([^\n.]+)/i,
  /(?:reset time|limit resets at)\s*:?\s*([^\n.]+)/i,
];

const TIMEZONE_PATTERN =
  /\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z]{2,5}|[A-Za-z]+\/[A-Za-z_/-]+)\b/;

function parseJsonMessages(output) {
  if (!output) {
    return [];
  }

  try {
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    const messages = [];
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || (!trimmed.startsWith('{') && !trimmed.startsWith('['))) {
        continue;
      }

      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          messages.push(...parsed);
        } else {
          messages.push(parsed);
        }
      } catch {
        // Ignore non-JSON lines mixed into CLI output.
      }
    }
    return messages;
  }
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

function cleanResetTime(value) {
  const cleaned = value?.trim().replace(/[),;]+$/g, '');
  if (!cleaned || cleaned.length > 120) {
    return null;
  }
  return cleaned;
}

function detectUsageLimit(plainOutput) {
  const output = plainOutput || '';
  const reached = USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(output));
  let resetTime = null;
  let timezone = null;

  if (reached) {
    for (const pattern of RESET_TIME_PATTERNS) {
      const match = output.match(pattern);
      resetTime = cleanResetTime(match?.[1]);
      if (resetTime) {
        break;
      }
    }

    const parentheticalTimezone = output.match(/\(([^)]+)\)/)?.[1];
    const timezoneCandidate =
      parentheticalTimezone?.match(TIMEZONE_PATTERN)?.[0] ||
      resetTime?.match(TIMEZONE_PATTERN)?.[0] ||
      output.match(/\btimezone\s*:?\s*([A-Za-z_/-]+|UTC[+-]?\d*)\b/i)?.[1];
    timezone = timezoneCandidate || null;
  }

  return { reached, resetTime, timezone };
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
      message.usage_by_model;
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
    if (model && usage && typeof usage === 'object') {
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

    const type = message.type || message.item?.type || message.item_type;
    if (typeof type === 'string' && /(?:sub[_-]?agent|collab)/i.test(type)) {
      calls.push({
        type,
        id: message.id || message.call_id || message.item?.id || null,
        name: message.name || message.tool || message.item?.name || null,
        status: message.status || message.state || null,
        summary: extractResultSummary({ messages: [message], plainOutput: '' }),
      });
    }
  }

  return calls.length > 0 ? calls : null;
}

function extractErrorFromMessages(messages) {
  for (const message of [...messages].reverse()) {
    if (!message || typeof message !== 'object') {
      continue;
    }

    const messageType = message.type || message.subtype || message.item?.type;
    if (
      message.is_error === true ||
      message.error ||
      messageType === 'error' ||
      messageType === 'step_error'
    ) {
      const error = message.error;
      const errorType =
        (typeof error === 'object' && (error.type || error.code)) ||
        message.errorType ||
        message.error_type ||
        messageType ||
        'execution_error';
      const errorMessage =
        (typeof error === 'string' && error) ||
        (typeof error === 'object' && (error.message || error.details)) ||
        textFromValue(message.message) ||
        textFromValue(message.result) ||
        'Execution failed';

      return { hasError: true, errorType, message: errorMessage };
    }
  }

  return { hasError: false, errorType: null, message: null };
}

function detectExecutionError({ exitCode, plainOutput, messages, toolConfig }) {
  if (toolConfig?.detectErrors) {
    const detected = toolConfig.detectErrors({ output: plainOutput || '' });
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
    const lastLine = (plainOutput || '')
      .trim()
      .split('\n')
      .filter(Boolean)
      .pop();
    return {
      hasError: true,
      errorType: 'exit_code',
      message: lastLine || `Process exited with code ${exitCode}`,
    };
  }

  return { hasError: false, errorType: null, message: null };
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
  } = options;
  const messages = normalizeMessages({ parsedOutput, plainOutput, toolConfig });
  const usageLimit = detectUsageLimit(plainOutput);
  const error = detectExecutionError({
    exitCode,
    plainOutput,
    messages,
    toolConfig,
  });
  const anthropicTotalCostUSD = firstNumber(messages, [
    'total_cost_usd',
    'totalCostUsd',
    'anthropicTotalCostUSD',
  ]);
  const estimate = publicPricingEstimate({ tool, usage });

  return {
    tool,
    exitCode,
    success: exitCode === 0 && !usageLimit.reached && !error.hasError,
    sessionId: extractSessionId({
      explicitSessionId: sessionId,
      messages,
    }),
    limitReached: usageLimit.reached,
    limitResetTime: usageLimit.resetTime,
    limitTimezone: usageLimit.timezone,
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
    resultModelUsage: extractResultModelUsage(messages),
    streamTokenUsage: usage,
    subAgentCalls: extractSubAgentCalls(messages),
    errorDuringExecution: error.hasError,
    errorType: error.errorType,
    errorMessage: error.message,
  };
}
