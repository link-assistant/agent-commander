/**
 * JSON Streaming utilities
 * Support for NDJSON (Newline Delimited JSON) input and output
 */

import { JsonOutputStream } from './output-stream.mjs';
import { JsonInputStream } from './input-stream.mjs';
import { parseNdjsonLine, stringifyNdjsonLine } from './ndjson.mjs';

export {
  JsonOutputStream,
  JsonInputStream,
  parseNdjsonLine,
  stringifyNdjsonLine,
};

/**
 * Create a JSON output stream processor
 * @param {Object} options - Options
 * @param {Function} [options.onMessage] - Callback for each parsed message
 * @param {Function} [options.onError] - Callback for parse errors
 * @returns {JsonOutputStream} JSON output stream processor
 */
export function createOutputStream(options = {}) {
  return new JsonOutputStream(options);
}

/**
 * Create a JSON input stream for sending messages
 * @param {Object} options - Options
 * @param {boolean} [options.compact] - Use compact JSON (no newlines within messages)
 * @returns {JsonInputStream} JSON input stream
 */
export function createInputStream(options = {}) {
  return new JsonInputStream(options);
}
