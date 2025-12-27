/**
 * JSON Input Stream
 * Creates NDJSON input for CLI tools
 */

import { stringifyNdjsonLine } from './ndjson.mjs';

/**
 * JSON Input Stream class
 * Builds NDJSON input for streaming to CLI tools
 */
export class JsonInputStream {
  /**
   * Create a JSON input stream
   * @param {Object} options - Options
   * @param {boolean} [options.compact] - Use compact JSON (default: true)
   */
  constructor(options = {}) {
    this.compact = options.compact !== false;
    this.messages = [];
  }

  /**
   * Add a message to the stream
   * @param {Object} options - Options
   * @param {Object} options.message - Message to add
   * @returns {JsonInputStream} This instance for chaining
   */
  add(options) {
    const { message } = options;
    if (message !== null && message !== undefined) {
      this.messages.push(message);
    }
    return this;
  }

  /**
   * Add a user prompt message
   * @param {Object} options - Options
   * @param {string} options.content - Prompt content
   * @returns {JsonInputStream} This instance for chaining
   */
  addPrompt(options) {
    const { content } = options;
    return this.add({
      message: {
        type: 'user_prompt',
        content,
      },
    });
  }

  /**
   * Add a system message
   * @param {Object} options - Options
   * @param {string} options.content - System message content
   * @returns {JsonInputStream} This instance for chaining
   */
  addSystemMessage(options) {
    const { content } = options;
    return this.add({
      message: {
        type: 'system',
        content,
      },
    });
  }

  /**
   * Add a configuration message
   * @param {Object} options - Options
   * @param {Object} options.config - Configuration object
   * @returns {JsonInputStream} This instance for chaining
   */
  addConfig(options) {
    const { config } = options;
    return this.add({
      message: {
        type: 'config',
        ...config,
      },
    });
  }

  /**
   * Convert the stream to NDJSON string
   * @returns {string} NDJSON string
   */
  toString() {
    return this.messages
      .map(message => stringifyNdjsonLine({ value: message, compact: this.compact }))
      .join('');
  }

  /**
   * Convert the stream to a Buffer
   * @returns {Buffer} Buffer containing NDJSON data
   */
  toBuffer() {
    return Buffer.from(this.toString(), 'utf-8');
  }

  /**
   * Get the number of messages in the stream
   * @returns {number} Message count
   */
  size() {
    return this.messages.length;
  }

  /**
   * Clear all messages
   * @returns {JsonInputStream} This instance for chaining
   */
  clear() {
    this.messages = [];
    return this;
  }

  /**
   * Get all messages
   * @returns {Object[]} Array of messages
   */
  getMessages() {
    return [...this.messages];
  }

  /**
   * Create from an array of messages
   * @param {Object} options - Options
   * @param {Object[]} options.messages - Array of messages
   * @param {boolean} [options.compact] - Use compact JSON
   * @returns {JsonInputStream} New input stream
   */
  static from(options) {
    const { messages, compact } = options;
    const stream = new JsonInputStream({ compact });
    if (Array.isArray(messages)) {
      for (const message of messages) {
        stream.add({ message });
      }
    }
    return stream;
  }
}
