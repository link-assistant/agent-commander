/**
 * JSON Output Stream processor
 * Processes NDJSON output from CLI tools
 */

import { createJsonRecordScanner } from './json-records.mjs';

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
    this.scanner = createJsonRecordScanner();
    this.messages = [];
    this.errors = [];
    this.lineCount = 0;
  }

  /**
   * Process a chunk of output data
   * Complete lines are scanned for balanced JSON records, so pretty-printed
   * records spanning several lines are parsed once their last line arrives.
   * @param {Object} options - Options
   * @param {string|Buffer} options.chunk - Data chunk to process
   * @returns {Object[]} Array of messages parsed from this chunk
   */
  process(options) {
    const { chunk } = options;
    const data = typeof chunk === 'string' ? chunk : chunk.toString();

    this.buffer += data;

    const boundary = this.buffer.lastIndexOf('\n');
    if (boundary < 0) {
      return [];
    }
    const complete = this.buffer.slice(0, boundary + 1);
    // Keep the last incomplete line in the buffer
    this.buffer = this.buffer.slice(boundary + 1);

    return this.scan(complete.split('\n').slice(0, -1), false);
  }

  /**
   * Flush any remaining data in the buffer
   * @returns {Object[]} Array of messages from flushed buffer
   */
  flush() {
    const lines = this.buffer.trim() ? [this.buffer] : [];
    this.buffer = '';
    return this.scan(lines, true);
  }

  /**
   * Scan complete lines and record parsed messages and parse errors
   * @param {string[]} lines - Complete lines
   * @param {boolean} final - Whether the output has ended
   * @returns {Object[]} Newly parsed messages
   */
  scan(lines, final) {
    const text = lines.map((line) => `${line}\n`).join('');
    for (const line of lines) {
      this.lineCount++;
      this.onRawLine({ line, lineNumber: this.lineCount });
    }

    const events = this.scanner.write(text);
    if (final) {
      events.push(...this.scanner.flush());
    }

    const newMessages = [];
    for (const event of events) {
      if (event.type === 'json') {
        this.messages.push(event.value);
        newMessages.push(event.value);
        this.onMessage({ message: event.value, lineNumber: this.lineCount });
      } else if (event.type === 'invalid') {
        // Looked like JSON but failed to parse
        const error = { line: event.raw, lineNumber: this.lineCount };
        this.errors.push(error);
        this.onError({ error, lineNumber: this.lineCount });
      }
    }

    return newMessages;
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
    this.scanner = createJsonRecordScanner();
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
