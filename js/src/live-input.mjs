/**
 * Live input for a running agent (issue #57).
 *
 * Claude Code (`-p --input-format stream-json`), Qwen Code and
 * @link-assistant/agent (`--input-format stream-json`) keep reading NDJSON
 * user frames from stdin while they work, so a caller can queue follow-up
 * messages into the same session. upcomputer steers and queues messages into
 * running Claude turns, and hive-mind feeds new PR comments into a running
 * session; both need the same frames. Claude and Qwen also accept an
 * `interrupt` control request, which ends the running turn (the Claude Agent
 * SDK's `Query.interrupt()`).
 */

let interruptCounter = 0;

// Tools whose stdin frames use the Anthropic message envelope and that
// answer an `interrupt` control request.
const ENVELOPE_TOOLS = new Set(['claude', 'qwen']);

/**
 * Whether a tool reads live NDJSON user frames from stdin.
 * @param {Object|null} toolConfig - Tool configuration
 * @returns {boolean}
 */
export function supportsLiveInput(toolConfig) {
  return Boolean(toolConfig?.supportsJsonInput);
}

/**
 * Error text for tools without a live input channel.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @returns {string} Error message
 */
export function liveInputUnsupportedError({ tool }) {
  return `Tool "${tool}" does not read live input (no stream-json stdin channel). Choose one of: claude, qwen, agent; or run without liveInput.`;
}

/**
 * Build one user-message frame.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name (`claude` | `qwen` | `agent`)
 * @param {string|Object[]} options.content - Message text, or Anthropic
 *   content blocks (text, image) for Claude and Qwen
 * @param {string} [options.systemPrompt] - Prepended to text for qwen and
 *   agent, which have no separate system-prompt channel on stdin
 * @returns {Object} Frame ready to be serialized as NDJSON
 */
export function buildUserInputFrame({ tool, content, systemPrompt }) {
  const withSystemPrompt = (text) =>
    systemPrompt ? `${systemPrompt}\n\n${text || ''}` : text || '';
  if (tool === 'claude') {
    // Claude stream-json input expects an Anthropic-style message envelope.
    return {
      type: 'user',
      message: { role: 'user', content: content ?? '' },
    };
  }
  if (ENVELOPE_TOOLS.has(tool) && Array.isArray(content)) {
    return { type: 'user', message: { role: 'user', content } };
  }
  if (typeof content !== 'string' && content !== undefined) {
    throw new TypeError(`Tool "${tool}" accepts only text live input`);
  }
  if (ENVELOPE_TOOLS.has(tool)) {
    return {
      type: 'user',
      message: { role: 'user', content: withSystemPrompt(content) },
    };
  }
  return { type: 'user', message: withSystemPrompt(content) };
}

/**
 * Build the control request that interrupts the running turn.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {string} [options.requestId] - Request id (generated when omitted)
 * @returns {Object} Frame ready to be serialized as NDJSON
 */
export function buildInterruptFrame({ tool, requestId }) {
  if (!ENVELOPE_TOOLS.has(tool)) {
    throw new Error(
      `Tool "${tool}" has no interrupt control request. Choose claude or qwen, or stop the agent instead.`
    );
  }
  interruptCounter += 1;
  return {
    type: 'control_request',
    request_id: requestId || `interrupt-${process.pid}-${interruptCounter}`,
    request: { subtype: 'interrupt' },
  };
}
