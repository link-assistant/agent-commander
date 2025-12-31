/**
 * JSON Output Stream processor
 * Processes NDJSON output from CLI tools
 */

import { parseNdjsonLine } from './ndjson.mjs';

/**
 * JSON Output Stream class
 * Processes streaming output and emits parsed JSON messages
 */
export class JsonOutputStream {
  /**
   * Create a JSON output stream processor
   * @param {Object} options - Options
   * @param {Function} [options.onMessage] - Callback for each parsed message
   * @param {Function} [options.onError] - Callback for parse errors
   * @param {Function} [options.onRawLine] - Callback for each raw line (before parsing)
   */
  constructor(options = {}) {
    this.onMessage = options.onMessage || (() => {});
    this.onError = options.onError || (() => {});
    this.onRawLine = options.onRawLine || (() => {});

    this.buffer = '';
    this.messages = [];
    this.errors = [];
    this.lineCount = 0;
  }

  /**
   * Process a chunk of output data
   * @param {Object} options - Options
   * @param {string|Buffer} options.chunk - Data chunk to process
   * @returns {Object[]} Array of messages parsed from this chunk
   */
  process(options) {
    const { chunk } = options;
    const data = typeof chunk === 'string' ? chunk : chunk.toString();

    this.buffer += data;

    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() || '';

    const newMessages = [];

    for (const line of lines) {
      this.lineCount++;
      this.onRawLine({ line, lineNumber: this.lineCount });

      const parsed = parseNdjsonLine({ line });

      if (parsed !== null) {
        this.messages.push(parsed);
        newMessages.push(parsed);
        this.onMessage({ message: parsed, lineNumber: this.lineCount });
      } else if (line.trim() && line.trim().startsWith('{')) {
        // Line looked like JSON but failed to parse
        const error = { line, lineNumber: this.lineCount };
        this.errors.push(error);
        this.onError({ error, lineNumber: this.lineCount });
      }
    }

    return newMessages;
  }

  /**
   * Flush any remaining data in the buffer
   * @returns {Object[]} Array of messages from flushed buffer
   */
  flush() {
    if (!this.buffer.trim()) {
      return [];
    }

    const line = this.buffer;
    this.buffer = '';
    this.lineCount++;

    this.onRawLine({ line, lineNumber: this.lineCount });

    const parsed = parseNdjsonLine({ line });

    if (parsed !== null) {
      this.messages.push(parsed);
      this.onMessage({ message: parsed, lineNumber: this.lineCount });
      return [parsed];
    } else if (line.trim() && line.trim().startsWith('{')) {
      const error = { line, lineNumber: this.lineCount };
      this.errors.push(error);
      this.onError({ error, lineNumber: this.lineCount });
    }

    return [];
  }

  /**
   * Get all collected messages
   * @returns {Object[]} Array of all parsed messages
   */
  getMessages() {
    return [...this.messages];
  }

  /**
   * Get all parse errors
   * @returns {Object[]} Array of error details
   */
  getErrors() {
    return [...this.errors];
  }

  /**
   * Reset the stream processor
   */
  reset() {
    this.buffer = '';
    this.messages = [];
    this.errors = [];
    this.lineCount = 0;
  }

  /**
   * Filter messages by type
   * @param {Object} options - Options
   * @param {string} options.type - Message type to filter
   * @returns {Object[]} Filtered messages
   */
  filterByType(options) {
    const { type } = options;
    return this.messages.filter((msg) => msg.type === type);
  }

  /**
   * Find first message matching a predicate
   * @param {Object} options - Options
   * @param {Function} options.predicate - Filter function
   * @returns {Object|undefined} First matching message
   */
  find(options) {
    const { predicate } = options;
    return this.messages.find(predicate);
  }
}
