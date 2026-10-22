/**
 * Structured output: the final answer shaped by the `jsonSchema` launch
 * option (issue #57). Claude reports it as `structured_output` and Qwen as
 * `structured_result` on the result message. Codex `--output-schema` shapes
 * the final agent message, which is JSON text.
 */

/**
 * Parse JSON text, or return null.
 * @param {string|null|undefined} text - JSON text
 * @returns {*} Parsed value or null
 */
function parseJsonText(text) {
  const trimmed = (text ?? '').trim();
  if (!trimmed) {
    return null;
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Text of the last Codex `agent_message` item.
 * @param {Object[]} messages - Parsed stream messages
 * @returns {string|null} Message text
 */
function lastCodexAgentMessage(messages) {
  for (const message of [...messages].reverse()) {
    const item = message?.item;
    if (
      message?.type === 'item.completed' &&
      item?.type === 'agent_message' &&
      typeof item.text === 'string'
    ) {
      return item.text;
    }
  }
  return null;
}

/**
 * Extract the structured output of a run.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {Object[]} [options.messages] - Parsed stream messages
 * @param {string} [options.plainOutput] - Raw stdout
 * @param {boolean} [options.requested] - A `jsonSchema` was passed; enables
 *   reading Codex's final message, which has no structured field
 * @returns {*} Structured value, or null when there is none
 */
export function extractStructuredOutput({
  tool,
  messages = [],
  plainOutput = '',
  requested = false,
}) {
  for (const message of [...messages].reverse()) {
    if (message?.type !== 'result') {
      continue;
    }
    for (const key of ['structured_output', 'structured_result']) {
      if (message[key] !== undefined) {
        return message[key];
      }
    }
  }
  if (!requested || tool !== 'codex') {
    return null;
  }
  // `codex exec --json` streams items; without `--json` stdout is the
  // final message itself.
  return parseJsonText(lastCodexAgentMessage(messages) ?? plainOutput);
}
