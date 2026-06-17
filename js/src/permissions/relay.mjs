/**
 * Permission relay for the uniform per-command approval ("ask") mode.
 *
 * A {@link PermissionRelay} sits between a backend CLI's streaming output and a
 * consumer: it watches parsed output messages for native permission requests,
 * normalizes them, asks the consumer for a decision, and writes the native
 * response frame back to the CLI's stdin as NDJSON.
 *
 * The relay is intentionally transport-agnostic — it does not own the child
 * process. The caller supplies a `write` function (typically the child's stdin)
 * and feeds it parsed messages, which keeps it fully unit-testable.
 */

import { stringifyNdjsonLine } from '../streaming/ndjson.mjs';
import {
  normalizePermissionRequest,
  buildPermissionResponse,
  ASK_DECISIONS,
} from './normalize.mjs';

/**
 * Relay native permission requests to a consumer and forward decisions back.
 */
export class PermissionRelay {
  /**
   * @param {Object} options - Options
   * @param {string} options.tool - Tool name (`agent` | `claude`)
   * @param {Function} options.onRequest - async (normalizedRequest) => decision
   *   where decision is `once` | `always` | `reject`
   * @param {Function} options.write - (line: string) => void; writes a serialized
   *   NDJSON frame to the tool's stdin
   * @param {boolean} [options.compact=true] - Use compact NDJSON
   */
  constructor(options) {
    const { tool, onRequest, write, compact = true } = options;
    if (!tool) {
      throw new Error('tool is required');
    }
    if (typeof onRequest !== 'function') {
      throw new Error('onRequest callback is required');
    }
    if (typeof write !== 'function') {
      throw new Error('write callback is required');
    }
    this.tool = tool;
    this.onRequest = onRequest;
    this.write = write;
    this.compact = compact;
    this.handled = [];
  }

  /**
   * Process a single parsed output message. When the message is a permission
   * request, resolves the consumer's decision and writes the native response.
   * @param {Object} options - Options
   * @param {Object} options.message - A parsed output message from the tool
   * @returns {Promise<Object|null>} { request, decision, frame } or null when the
   *   message is not a permission request
   */
  async handleMessage(options) {
    const { message } = options;
    const request = normalizePermissionRequest({ tool: this.tool, message });
    if (!request) {
      return null;
    }

    let decision = await this.onRequest(request);
    // Default to the safe choice if the consumer returns nothing usable.
    if (!ASK_DECISIONS.has(decision)) {
      decision = 'reject';
    }

    const frame = buildPermissionResponse({
      tool: this.tool,
      request,
      decision,
    });
    this.write(stringifyNdjsonLine({ value: frame, compact: this.compact }));

    const record = { request, decision, frame };
    this.handled.push(record);
    return record;
  }

  /**
   * All permission requests handled so far (for inspection/testing).
   * @returns {Array<Object>} Handled { request, decision, frame } records
   */
  getHandled() {
    return this.handled;
  }
}

/**
 * Convenience factory for a {@link PermissionRelay}.
 * @param {Object} options - See {@link PermissionRelay} constructor
 * @returns {PermissionRelay} A new relay
 */
export function createPermissionRelay(options) {
  return new PermissionRelay(options);
}
