/**
 * NDJSON (Newline Delimited JSON) utilities
 * https://github.com/ndjson/ndjson-spec
 */

/**
 * Parse a single NDJSON line
 * @param {Object} options - Options
 * @param {string} options.line - Line to parse
 * @returns {Object|null} Parsed object or null if invalid
 */
export function parseNdjsonLine(options) {
  const { line } = options;
  const trimmed = (line || '').trim();

  // Empty lines are ignored in NDJSON
  if (!trimmed) {
    return null;
  }

  // Must start with { or [ to be valid JSON
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

/**
 * Stringify an object to NDJSON line
 * @param {Object} options - Options
 * @param {Object} options.value - Value to stringify
 * @param {boolean} [options.compact] - Use compact JSON (no indentation)
 * @returns {string} NDJSON line (with trailing newline)
 */
export function stringifyNdjsonLine(options) {
  const { value, compact = true } = options;

  if (value === null || value === undefined) {
    return '';
  }

  const json = compact
    ? JSON.stringify(value)
    : JSON.stringify(value, null, 2);

  return json + '\n';
}

/**
 * Parse multiple NDJSON lines
 * @param {Object} options - Options
 * @param {string} options.data - Data containing multiple lines
 * @returns {Object[]} Array of parsed objects
 */
export function parseNdjson(options) {
  const { data } = options;
  const lines = (data || '').split('\n');
  const results = [];

  for (const line of lines) {
    const parsed = parseNdjsonLine({ line });
    if (parsed !== null) {
      results.push(parsed);
    }
  }

  return results;
}

/**
 * Stringify multiple objects to NDJSON
 * @param {Object} options - Options
 * @param {Object[]} options.values - Values to stringify
 * @param {boolean} [options.compact] - Use compact JSON
 * @returns {string} NDJSON string
 */
export function stringifyNdjson(options) {
  const { values, compact = true } = options;

  if (!values || !Array.isArray(values)) {
    return '';
  }

  return values
    .map(value => stringifyNdjsonLine({ value, compact }))
    .join('');
}
