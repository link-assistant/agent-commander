/** Native usage records are snapshots, step deltas, or final totals. */
function latestSnapshots(messages) {
  const snapshots = new Map();
  const anonymous = [];
  for (const event of messages) {
    if (event.parent_tool_use_id) {
      continue;
    }
    const record =
      event.usage ||
      event.message?.usage ||
      event.result?.usage ||
      event.usageMetadata;
    if (!record) {
      continue;
    }
    const id = event.message?.id;
    if (id) {
      snapshots.set(id, record);
    } else {
      anonymous.push(record);
    }
  }
  return [...anonymous, ...snapshots.values()];
}

function recordsFor(tool, messages) {
  if (tool === 'opencode' || tool === 'agent') {
    return messages
      .map((event) =>
        event.type === 'step_finish' && event.part?.tokens
          ? { ...event.part.tokens, cost: event.part.cost, step: true }
          : event.usage
      )
      .filter(Boolean);
  }
  if (tool === 'gemini') {
    const stats = [...messages]
      .reverse()
      .find(
        (event) =>
          (event.type === 'result' || event.response !== undefined) &&
          event.stats
      )?.stats;
    if (stats) {
      return stats.models
        ? Object.values(stats.models).map((model) => model.tokens || {})
        : [stats];
    }
  }
  if (tool === 'claude' || tool === 'qwen') {
    const result = [...messages]
      .reverse()
      .find(
        (event) =>
          !event.parent_tool_use_id &&
          event.type === 'result' &&
          (event.usage || event.result?.usage)
      );
    if (result) {
      return [result.usage || result.result.usage];
    }
  }
  return latestSnapshots(messages);
}

function number(record, paths) {
  for (const path of paths) {
    const value = path
      .split('.')
      .reduce((object, key) => object?.[key], record);
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return 0;
}

const FIELDS = {
  inputTokens: [
    'input_tokens',
    'promptTokens',

    'inputTokens',
    'input',
    'prompt_tokens',
    'prompt',
    'promptTokenCount',
  ],
  outputTokens: [
    'output_tokens',
    'completionTokens',

    'outputTokens',
    'output',
    'completion_tokens',
    'completion',
    'candidates',
    'candidatesTokenCount',
  ],
  cacheReadTokens: [
    'cached_input_tokens',
    'cachedInputTokens',
    'cache_read_tokens',
    'input_tokens_details.cached_tokens',
    'input_tokens_details.cache_read_tokens',

    'cache_read_input_tokens',
    'cacheReadTokens',
    'cacheRead',
    'cache_read',
    'cached',
    'cachedContentTokenCount',
    'prompt_tokens_details.cached_tokens',
    'cache.read',
  ],
  cacheCreationTokens: [
    'cache_creation_input_tokens',
    'cacheCreationTokens',
    'cacheCreationInputTokens',
    'cache_write_tokens',
    'input_tokens_details.cache_write_tokens',
    'input_tokens_details.cache_creation_tokens',
    'input_tokens_details.cache_creation_input_tokens',

    'cacheWriteTokens',
    'cacheWrite',
    'cache_write',
    'cache.write',
  ],
  reasoningTokens: [
    'reasoning_output_tokens',
    'thoughtsTokens',
    'thoughts_tokens',
    'output_tokens_details.reasoning_tokens',

    'reasoning_tokens',
    'reasoningTokens',
    'reasoning',
    'thoughts',
    'thoughtsTokenCount',
  ],
  totalTokens: ['total_tokens', 'totalTokens', 'total', 'totalTokenCount'],
};

export function nativeUsage(tool, messages) {
  const usage = { inputTokens: 0, outputTokens: 0 };
  if (tool === 'claude') {
    Object.assign(usage, { cacheCreationTokens: 0, cacheReadTokens: 0 });
  }
  if (tool === 'qwen' || tool === 'gemini') {
    usage.totalTokens = 0;
  }
  for (const record of recordsFor(
    tool,
    messages.filter((event) => event && typeof event === 'object')
  )) {
    for (const [field, paths] of Object.entries(FIELDS)) {
      const count = number(record, paths);
      if (count || Object.hasOwn(usage, field)) {
        usage[field] = (usage[field] || 0) + count;
      }
    }
    // Codex reports inclusive input; Hive Mind's normalized input excludes reads.
    if (tool === 'codex') {
      usage.inputTokens -= Math.min(
        number(record, FIELDS.inputTokens),
        number(record, FIELDS.cacheReadTokens)
      );
    }
    if (record.step) {
      usage.stepCount = (usage.stepCount || 0) + 1;
      usage.totalCost = (usage.totalCost || 0) + number(record, ['cost']);
    }
  }
  if ((tool === 'qwen' || tool === 'gemini') && !usage.totalTokens) {
    usage.totalTokens =
      usage.inputTokens +
      usage.outputTokens +
      (tool === 'qwen'
        ? (usage.cacheReadTokens || 0) + (usage.cacheCreationTokens || 0)
        : 0);
  }
  if (tool === 'opencode' && usage.cacheCreationTokens !== undefined) {
    usage.cacheWriteTokens = usage.cacheCreationTokens;
    delete usage.cacheCreationTokens;
  }
  return usage;
}
