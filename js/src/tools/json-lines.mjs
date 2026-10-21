/**
 * Shared parsing helpers for native CLI tool output
 */

import { parseJsonRecords } from '../streaming/json-records.mjs';

/**
 * Parse JSON objects from tool output, skipping diagnostics and invalid text
 * Accepts NDJSON as well as pretty-printed and concatenated records.
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object[]} Array of parsed JSON messages
 */
export function parseJsonLines(options) {
  return parseJsonRecords(options.output).filter(
    (value) => value && typeof value === 'object' && !Array.isArray(value)
  );
}

/**
 * Create a mapper from model aliases to full model IDs
 * Unknown values are exact model IDs and pass through unchanged.
 * @param {Object<string, string>} modelMap - Alias to model ID map
 * @returns {function({model: string}): string} Mapper
 */
export function createModelMapper(modelMap) {
  return ({ model }) => modelMap[model] || model;
}
