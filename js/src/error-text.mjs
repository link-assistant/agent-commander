/**
 * Human-readable rendering of structured error payloads
 *
 * Agentic CLIs publish errors as objects: `@link-assistant/agent` emits
 * `NamedError.toObject()` (`{"name":"RetryTimeoutExceededError","data":{"message":"…"}}`),
 * which became "[object Object]" when interpolated. Ported from Hive Mind
 * `src/error-text.lib.mjs` (hive-mind#2141).
 */

export const MAX_ERROR_TEXT_LENGTH = 2000;

const PLACEHOLDER_ERROR_TEXTS = new Set([
  '[object object]',
  '[object error]',
  'undefined',
  'null',
  '{}',
  '[]',
]);

const isPlaceholder = (text) =>
  PLACEHOLDER_ERROR_TEXTS.has(text.trim().toLowerCase());

const safeJsonStringify = (value) => {
  try {
    return JSON.stringify(value) || '';
  } catch {
    return '';
  }
};

const NESTED_KEYS = [
  'message',
  'data',
  'error',
  'reason',
  'cause',
  'detail',
  'details',
  'description',
  'hint',
  'result',
  'stderr',
];

function stringifyValue(value, depth) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string') {
    return value.trim();
  }
  if (typeof value !== 'object') {
    return String(value);
  }
  if (depth > 4) {
    return safeJsonStringify(value);
  }
  if (Array.isArray(value)) {
    return value
      .map((entry) => stringifyValue(entry, depth + 1))
      .filter(Boolean)
      .join('; ');
  }
  if (value instanceof Error) {
    return [value.name !== 'Error' ? value.name : '', value.message]
      .filter(Boolean)
      .join(': ');
  }

  const name =
    typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : null;
  for (const key of NESTED_KEYS) {
    const rendered = stringifyValue(value[key], depth + 1);
    if (!rendered || isPlaceholder(rendered)) {
      continue;
    }
    return name && rendered !== name ? `${name}: ${rendered}` : rendered;
  }
  if (name) {
    return name;
  }
  const json = safeJsonStringify(value);
  return json === '{}' ? '' : json;
}

/**
 * Render any error payload as one readable line, never "[object Object]"
 * @param {*} value - String, Error, NamedError object, or nested envelope
 * @param {Object} [options] - Options
 * @param {number} [options.maxLength] - Truncation budget
 * @param {string} [options.fallback] - Returned when nothing readable is found
 * @returns {string}
 */
export function stringifyErrorValue(
  value,
  { maxLength = MAX_ERROR_TEXT_LENGTH, fallback = '' } = {}
) {
  const rendered = stringifyValue(value, 0);
  if (!rendered || isPlaceholder(rendered)) {
    return fallback;
  }
  return rendered.length > maxLength
    ? `${rendered.slice(0, maxLength)}… (truncated)`
    : rendered;
}

/**
 * Pick the first readable rendering among candidate payloads
 * @param {Array<*>} candidates - Candidate payloads in priority order
 * @param {Object} [options] - Same options as stringifyErrorValue
 * @returns {string}
 */
export function firstErrorText(candidates, { maxLength, fallback = '' } = {}) {
  for (const candidate of candidates) {
    const rendered = stringifyErrorValue(candidate, { maxLength });
    if (rendered) {
      return rendered;
    }
  }
  return fallback;
}
