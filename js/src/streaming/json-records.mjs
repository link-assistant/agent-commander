/**
 * Balanced JSON record scanner for native CLI output
 *
 * Line-based NDJSON parsing drops every structured event when a tool prints
 * pretty-printed JSON (the `@link-assistant/agent` CLI does so unless
 * `--compact-json` is passed), concatenates records without a separator, or
 * splits one record across process chunks. Scanning for balanced JSON values
 * handles all three shapes, and NDJSON is the single-line special case.
 * Ported from Hive Mind `src/json-stream.lib.mjs` (hive-mind#2119, #1250).
 */

/** An unbalanced fragment (prose starting with `{`) is released past this size. */
export const DEFAULT_MAX_PENDING_BYTES = 4 * 1024 * 1024;

const isOpener = (character) => character === '{' || character === '[';

/**
 * Find the index just past the JSON value that starts at `start`
 * @param {string} buffer - Buffered text
 * @param {number} start - Index of the opening bracket
 * @returns {number} End index (exclusive), or -1 while the value is incomplete
 */
function findValueEnd(buffer, start) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < buffer.length; index++) {
    const character = buffer[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (isOpener(character)) {
      depth++;
    } else if (character === '}' || character === ']') {
      depth--;
      if (depth === 0) {
        return index + 1;
      }
      if (depth < 0) {
        return -1;
      }
    }
  }

  return -1;
}

/**
 * Create a stateful scanner that turns output text into JSON and text events
 *
 * Events are `{type:'json', value, raw}` and `{type:'text', value}` for every
 * other non-empty line; a balanced `{...}` fragment that is not valid JSON is
 * additionally reported as `{type:'invalid', raw}` before its text line.
 * @param {Object} [options] - Options
 * @param {number} [options.maxPendingBytes] - Release an unbalanced buffer past this size
 * @returns {{write: function(string): Object[], flush: function(): Object[], pending: function(): string}}
 */
export function createJsonRecordScanner(options = {}) {
  const maxPendingBytes = options.maxPendingBytes ?? DEFAULT_MAX_PENDING_BYTES;
  let pending = '';

  const pushText = (text, events) => {
    for (const line of text.split('\n')) {
      const value = line.replace(/\r$/, '');
      if (value.trim()) {
        events.push({ type: 'text', value });
      }
    }
  };

  const scan = (final) => {
    const events = [];
    let index = 0;

    while (index < pending.length) {
      const character = pending[index];
      if (/\s/.test(character)) {
        index++;
        continue;
      }

      if (isOpener(character)) {
        const end = findValueEnd(pending, index);
        if (end >= 0) {
          const raw = pending.slice(index, end);
          try {
            events.push({ type: 'json', value: JSON.parse(raw), raw });
            index = end;
            continue;
          } catch {
            // Bracketed prose such as "[INFO] ..." stays one text line.
            if (character === '{' && (final || pending.includes('\n', index))) {
              events.push({ type: 'invalid', raw });
            }
          }
        } else if (!final) {
          break;
        }
        // Not JSON, or the output ended inside this value: keep the line as
        // text and resume on the next line so later records are not lost.
      }

      const newline = pending.indexOf('\n', index);
      if (newline < 0 && !final) {
        break;
      }
      const lineEnd = newline < 0 ? pending.length : newline;
      pushText(pending.slice(index, lineEnd), events);
      index = lineEnd + 1;
    }

    pending = pending.slice(Math.min(index, pending.length));
    if (pending.length > maxPendingBytes) {
      pushText(pending, events);
      pending = '';
    }
    return events;
  };

  return {
    write(chunk) {
      pending += String(chunk ?? '');
      return scan(false);
    },
    flush() {
      const events = scan(true);
      pending = '';
      return events;
    },
    pending() {
      return pending;
    },
  };
}

/**
 * Extract every complete JSON value from finished output, in stream order
 * @param {string} output - Raw tool output
 * @returns {Array<*>} Parsed JSON values
 */
export function parseJsonRecords(output) {
  const scanner = createJsonRecordScanner();
  return [...scanner.write(output), ...scanner.flush()]
    .filter((event) => event.type === 'json')
    .map((event) => event.value);
}
