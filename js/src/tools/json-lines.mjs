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
 * Aliases match case-insensitively (`Opus` is `opus`, as in Hive Mind).
 * Unknown values are exact model IDs and pass through unchanged, unless
 * `fallback` names a model ID for them.
 * @param {Object<string, string>} modelMap - Alias to model ID map
 * @param {function(string): (string|null)} [fallback] - Resolves values the
 *   map does not know
 * @returns {function({model: string}): string} Mapper
 */
export function createModelMapper(modelMap, fallback = () => null) {
  const lowerCaseMap = new Map(
    Object.entries(modelMap).map(([alias, id]) => [alias.toLowerCase(), id])
  );
  return ({ model }) => {
    if (typeof model !== 'string') {
      return model;
    }
    return (
      modelMap[model] ||
      lowerCaseMap.get(model.toLowerCase()) ||
      fallback(model) ||
      model
    );
  };
}
