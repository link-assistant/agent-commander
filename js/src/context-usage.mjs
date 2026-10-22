/**
 * Context-window usage of a run (issue #57).
 *
 * Every Claude Code (and Qwen Code) `assistant` stream message carries the
 * request's `usage`; the prompt side (`input_tokens` +
 * `cache_creation_input_tokens` + `cache_read_input_tokens`) plus
 * `output_tokens` is what the next request has to carry. The `result`
 * message reports each model's `contextWindow` in `modelUsage`. Codex reports
 * `last_token_usage.total_tokens` and `model_context_window` in rollout
 * `token_count` events (`tokenUsage.last.totalTokens` and
 * `modelContextWindow` on the app-server). upcomputer draws its context
 * gauge from these numbers and hive-mind sizes sub-sessions and reports the
 * peak context from them.
 */

const count = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;

const positive = (value) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : null;

/**
 * Tokens one Claude-style request fills: prompt (fresh, cache writes and
 * cache reads) plus its output.
 * @param {Object} usage - Anthropic `usage`
 * @returns {number} Tokens
 */
export function claudeRequestContextTokens(usage) {
  return (
    count(usage?.input_tokens) +
    count(usage?.cache_creation_input_tokens) +
    count(usage?.cache_read_input_tokens) +
    count(usage?.output_tokens)
  );
}

/**
 * The context reading one stream or rollout message carries, or null.
 * Sub-agent messages (`parent_tool_use_id`) fill their own context.
 * @param {Object} message - Parsed message
 * @returns {{usedTokens: number, maxTokens: number|null, model: string|null}|null}
 */
export function contextReadingFromMessage(message) {
  if (!message || typeof message !== 'object' || message.parent_tool_use_id) {
    return null;
  }
  if (message.type === 'assistant' && message.message?.usage) {
    const usedTokens = claudeRequestContextTokens(message.message.usage);
    return usedTokens > 0
      ? { usedTokens, maxTokens: null, model: message.message.model || null }
      : null;
  }
  const info =
    message.type === 'token_count'
      ? message.info
      : message.payload?.type === 'token_count'
        ? message.payload.info
        : null;
  if (info) {
    const usedTokens = count(info.last_token_usage?.total_tokens);
    return usedTokens > 0
      ? {
          usedTokens,
          maxTokens: positive(info.model_context_window),
          model: null,
        }
      : null;
  }
  const tokenUsage = message.params?.tokenUsage ?? message.tokenUsage;
  if (tokenUsage?.last) {
    const usedTokens = count(tokenUsage.last.totalTokens);
    return usedTokens > 0
      ? {
          usedTokens,
          maxTokens: positive(tokenUsage.modelContextWindow),
          model: null,
        }
      : null;
  }
  return null;
}

// `modelUsage` entry for a model id; Claude may key it with a suffix.
function contextWindowFor(modelUsage, model) {
  const entries = Object.entries(modelUsage || {}).filter(([, usage]) =>
    positive(usage?.contextWindow)
  );
  const match =
    entries.find(([id]) => id === model) ||
    entries.find(
      ([id]) => model && (id.startsWith(model) || model.startsWith(id))
    ) ||
    (entries.length === 1 ? entries[0] : null);
  return match ? match[1].contextWindow : null;
}

/**
 * Fold a run's context usage: the last request's fill, the peak fill, the
 * model's context window when reported, and how many times the tool
 * compacted the conversation.
 * @param {Object[]} messages - Parsed messages in stream order
 * @returns {{usedTokens: number, peakTokens: number, maxTokens: number|null, usedPercent: number|null, model: string|null, compactions: number}|null}
 *   null when the run reported no token usage
 */
export function extractContextUsage(messages = []) {
  let last = null;
  let peakTokens = 0;
  let maxTokens = null;
  let compactions = 0;
  let modelUsage = null;
  for (const message of Array.isArray(messages) ? messages : []) {
    if (message?.type === 'system' && message.subtype === 'compact_boundary') {
      compactions += 1;
    }
    if (message?.type === 'result' && message.modelUsage) {
      modelUsage = message.modelUsage;
    }
    const reading = contextReadingFromMessage(message);
    if (reading) {
      last = reading;
      peakTokens = Math.max(peakTokens, reading.usedTokens);
      maxTokens = reading.maxTokens ?? maxTokens;
    }
  }
  if (!last) {
    return null;
  }
  maxTokens ??= contextWindowFor(modelUsage, last.model);
  return {
    usedTokens: last.usedTokens,
    peakTokens,
    maxTokens,
    usedPercent: maxTokens
      ? Math.round((last.usedTokens / maxTokens) * 1e6) / 1e4
      : null,
    model: last.model,
    compactions,
  };
}
