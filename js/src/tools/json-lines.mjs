/**
 * Shared parsing helpers for native CLI tool output
 */

/**
 * Parse newline-delimited JSON objects, skipping diagnostics and invalid lines
 * @param {Object} options - Options
 * @param {string} options.output - Raw output string
 * @returns {Object[]} Array of parsed JSON messages
 */
export function parseJsonLines(options) {
  const { output } = options;
  const messages = [];

  for (const line of output.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || !trimmed.startsWith('{')) {
      continue;
    }

    try {
      messages.push(JSON.parse(trimmed));
    } catch {
      // Skip lines that aren't valid JSON
    }
  }

  return messages;
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
