/**
 * Usage-limit detection shared by every tool's result metadata
 *
 * Ported from Hive Mind `src/usage-limit.lib.mjs` and
 * `src/claude.usage-limit-sources.lib.mjs` (hive-mind#1122, #1290, #1869,
 * #1924, #1935, #2687, #3570). Reset times are normalized to the shapes Hive
 * Mind's `parseResetTime` accepts (`MMM D, YYYY, h:mm A`, `MMM D, h:mm A`,
 * `h:mm A`) so the value can be handed straight back to it.
 */

import { createJsonRecordScanner } from './streaming/json-records.mjs';

const MONTH =
  '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

export const USAGE_LIMIT_PATTERNS = [
  // "You've hit your usage limit" (Codex), "hit your session/weekly limit" (Claude)
  /hit your (?:\w+ )?limit/i,
  /you have exceeded your rate limit/i,
  /usage limit (?:reached|exceeded)/i,
  // Require an explicit qualifier: header names such as
  // "anthropic-ratelimit-unified-5h-reset" are not a signal (issue #37), and
  // "Rate limited" is a transient server throttle (hive-mind#1924).
  /rate[_\s-]?limit[_\s-]?(?:reached|exceeded)/i,
  /limit (?:has been )?reached/i,
  /billing hard limit/i,
  /please try again at/i,
  /available again at/i,
  // "resets 5am" / "resets Jan 15, 8am", but not "loads a shell and resets" (hive-mind#1290)
  new RegExp(`resets\\s+(?:(?:at\\s+)?[0-9]|${MONTH}\\b)`, 'i'),
  /freeusagelimiterror/i,
];

const THROTTLE_PATTERN = /not your usage limit/i;

const RAW_RESET_TIME_PATTERNS = [
  /(?:resets?|try again|available again|available)\s+(?:at|on)?\s*([^\n."]+)/i,
  /(?:reset time|limit resets at)\s*:?\s*([^\n."]+)/i,
];

const TIMEZONE_PATTERN =
  /\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|(?!(?:AM|PM)\b)[A-Z]{2,5}|[A-Za-z]+\/[A-Za-z_/-]+)\b/;

const RATE_LIMIT_WINDOWS = {
  five_hour: 'session (5-hour)',
  seven_day: 'weekly',
  seven_day_opus: 'weekly Opus',
  seven_day_sonnet: 'weekly Sonnet',
};

// `[log_be123b] response error (error; no more retries left) {` from ANTHROPIC_LOG=debug
const DEBUG_BLOCK_START = /^\[log_[0-9a-f]+\]\s/i;
const DEBUG_RESPONSE_ERROR = /^\[log_[0-9a-f]+\]\s+response error\b/i;
// The debug logger's compressed body dumps (hive-mind#3570).
const BASE64_DUMP_LINE = /^[A-Za-z0-9+/=]{120,}$/;
const HEADER_LINE = /^\s*"?([a-z0-9-]+)"?\s*:\s*"?([^",]*)"?,?\s*$/i;

/**
 * Whether text reports an account usage limit (not a transient throttle)
 * @param {string} text - Text to inspect
 * @returns {boolean}
 */
export function isUsageLimitText(text) {
  return (
    typeof text === 'string' &&
    USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(text))
  );
}

function cleanResetTime(value) {
  let cleaned = value?.trim().replace(/[,;}\]]+$/g, '');
  // Keep "11am (UTC)" but drop the ")" of "(... try again at 5pm)".
  if (cleaned && /\)$/.test(cleaned) && !cleaned.includes('(')) {
    cleaned = cleaned.replace(/\)+$/, '');
  }
  if (!cleaned || cleaned.length > 120) {
    return null;
  }
  return cleaned;
}

const twelveHour = (hour, minute, ampm) =>
  `${hour}:${minute || '00'} ${ampm.toUpperCase()}`;

/**
 * Extract a reset time, normalized like Hive Mind's `extractResetTime`
 * @param {string} text - Usage-limit text
 * @returns {string|null} e.g. "Jun 11, 2026, 12:27 AM", "Jan 15, 8:00 AM", "5:00 PM"
 */
export function extractResetTime(text) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  const normalized = text.replace(/\s+/g, ' ');

  // A calendar date comes first so a weekly reset is never cut to a bare time (hive-mind#1869).
  const date = normalized.match(
    new RegExp(
      `(${MONTH})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?,?\\s+(?:at\\s+)?([0-9]{1,2})(?::([0-9]{2}))?\\s*([ap]m)`,
      'i'
    )
  );
  if (date) {
    const [, month, day, year, hour, minute, ampm] = date;
    const time = twelveHour(hour, minute, ampm);
    return year
      ? `${month} ${day}, ${year}, ${time}`
      : `${month} ${day}, ${time}`;
  }

  const keyword = normalized.match(
    /(?:try again|available(?: again)?|resets?)(?:\s+at)?\s+([0-9]{1,2})(?::([0-9]{2}))?\s*([ap]m)\b/i
  );
  if (keyword) {
    return twelveHour(keyword[1], keyword[2], keyword[3]);
  }

  const resets24h = normalized.match(
    /resets?(?:\s+at)?\s+([0-2]?[0-9]):([0-5][0-9])\b(?!\s*[ap]m)(?![-:\d])/i
  );
  if (resets24h) {
    const hour = parseInt(resets24h[1], 10);
    const hour12 = hour % 12 === 0 ? 12 : hour % 12;
    return `${hour12}:${resets24h[2]} ${hour >= 12 ? 'PM' : 'AM'}`;
  }

  // Unrecognized shapes such as "2026-05-01 18:30 UTC" are kept verbatim.
  for (const pattern of RAW_RESET_TIME_PATTERNS) {
    const resetTime = cleanResetTime(normalized.match(pattern)?.[1]);
    if (resetTime) {
      return resetTime;
    }
  }

  return null;
}

/**
 * Extract the reset timezone ("(Europe/Berlin)", "(UTC)", "18:30 UTC")
 * @param {string} text - Usage-limit text
 * @param {string|null} [resetTime] - Raw reset time already extracted
 * @returns {string|null}
 */
export function extractTimezone(text, resetTime = null) {
  if (!text || typeof text !== 'string') {
    return null;
  }
  const iana = text.match(/\(([A-Za-z_]+(?:\/[A-Za-z_]+){0,2})\)/)?.[1];
  if (iana && TIMEZONE_PATTERN.test(iana)) {
    return iana;
  }
  return (
    text.match(/\(([^)]+)\)/)?.[1]?.match(TIMEZONE_PATTERN)?.[0] ||
    resetTime?.match(TIMEZONE_PATTERN)?.[0] ||
    text.match(/\btimezone\s*:?\s*([A-Za-z_/-]+|UTC[+-]?\d*)\b/i)?.[1] ||
    null
  );
}

/**
 * Format an epoch (seconds) as `MMM D, YYYY, h:mm A` in UTC
 * @param {number} epochSeconds - Epoch seconds
 * @returns {string|null}
 */
export function formatEpochResetTimeUtc(epochSeconds) {
  const seconds = Number(epochSeconds);
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return null;
  }
  const date = new Date(seconds * 1000);
  const hours = date.getUTCHours();
  const minutes = String(date.getUTCMinutes()).padStart(2, '0');
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}, ${hours % 12 || 12}:${minutes} ${hours < 12 ? 'AM' : 'PM'}`;
}

const epochVerdict = (resetsAt, window) => ({
  reached: true,
  resetTime: formatEpochResetTimeUtc(resetsAt),
  timezone: 'UTC',
  resetsAt,
  window: window || null,
});

/**
 * Classify a Claude `rate_limit_event.rate_limit_info` (hive-mind#3570)
 *
 * `status: "rejected"` with `resetsAt`, or a window at 100% without overage, is
 * a usage limit. `rejected` without `resetsAt` is a server throttle (#1924).
 * @param {Object} info - rate_limit_info
 * @returns {{reached: boolean, throttled: boolean, resetTime?: string, timezone?: string, resetsAt?: number, window?: string}}
 */
export function classifyRateLimitEvent(info) {
  if (!info || typeof info !== 'object') {
    return { reached: false, throttled: false };
  }
  const resetsAt = Number(info.resetsAt);
  const hasReset = Number.isFinite(resetsAt) && resetsAt > 0;
  const utilization = Number(info.utilization);
  const overageUnavailable =
    info.isUsingOverage !== true &&
    (info.overageStatus === undefined ||
      info.overageStatus === 'rejected' ||
      info.overageEnabled === false);
  const exhausted =
    Number.isFinite(utilization) && utilization >= 1 && overageUnavailable;
  if (hasReset && (info.status === 'rejected' || exhausted)) {
    return {
      ...epochVerdict(resetsAt, info.rateLimitType),
      throttled: false,
    };
  }
  return { reached: false, throttled: !hasReset && info.status === 'rejected' };
}

/**
 * Read `ANTHROPIC_LOG=debug` output lines: which lines are debug output, and
 * the 429 `anthropic-ratelimit-unified-*` verdict (hive-mind#3570)
 * @param {string[]} lines - Raw non-JSON output lines
 * @returns {{debugLines: Set<number>, verdict: Object}}
 */
export function classifyDebugLines(lines) {
  const debugLines = new Set();
  let block = null;
  let verdict = { reached: false, throttled: false };

  lines.forEach((rawLine, index) => {
    const line = String(rawLine ?? '').replace(/\r$/, '');
    if (block) {
      debugLines.add(index);
      if (/^}\s*$/.test(line)) {
        const resetsAt = Number(
          block.headers?.['anthropic-ratelimit-unified-reset']
        );
        if (
          block.status === 429 &&
          block.headers['anthropic-ratelimit-unified-status'] === 'rejected' &&
          Number.isFinite(resetsAt) &&
          resetsAt > 0
        ) {
          verdict = {
            ...epochVerdict(
              resetsAt,
              block.headers['anthropic-ratelimit-unified-representative-claim']
            ),
            throttled: false,
          };
        }
        block = null;
      } else if (!block.skip) {
        const status = line.match(/^\s*status:\s*(\d{3}),?\s*$/);
        if (status) {
          block.status = Number(status[1]);
        }
        const header = line.match(HEADER_LINE);
        if (header && /^(anthropic-ratelimit-|retry-after$)/i.test(header[1])) {
          block.headers[header[1].toLowerCase()] = header[2].trim();
        }
      }
      return;
    }
    if (DEBUG_BLOCK_START.test(line)) {
      debugLines.add(index);
      if (/\{\s*$/.test(line)) {
        block = DEBUG_RESPONSE_ERROR.test(line)
          ? { status: null, headers: {} }
          : { skip: true };
      }
    } else if (BASE64_DUMP_LINE.test(line.trim())) {
      debugLines.add(index);
    }
  });

  return { debugLines, verdict };
}

/** A failed tool call is a tool result the model recovers from (hive-mind#3213). */
export function isRecoverableToolError(event) {
  if (event?.type !== 'error' && event?.type !== 'step_error') {
    return false;
  }
  return (
    event.recoverable === true ||
    (event.part?.type === 'tool' && event.part.state?.status === 'error')
  );
}

/**
 * Events whose text is tool or sub-agent output: a repository that mentions
 * "limit reached" must not mark the run as limited.
 */
function isToolOutputEvent(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)) {
    return false;
  }
  const type = event.type;
  return Boolean(
    event.parent_tool_use_id ||
    type === 'user' ||
    type === 'tool_use' ||
    type === 'tool_result' ||
    (typeof type === 'string' &&
      type.startsWith('item.') &&
      event.item?.type !== 'error') ||
    isRecoverableToolError(event)
  );
}

function collectStrings(value, out) {
  if (typeof value === 'string') {
    out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((entry) => collectStrings(entry, out));
  } else if (value && typeof value === 'object') {
    if (value.type === 'tool_use' || value.type === 'tool_result') {
      return;
    }
    for (const [key, entry] of Object.entries(value)) {
      if (key !== 'tool_use_result') {
        collectStrings(entry, out);
      }
    }
  }
}

/**
 * Split raw output into JSON records and the remaining text lines
 * @param {string} output - Raw output
 * @returns {{records: Object[], lines: string[]}}
 */
export function splitOutput(output) {
  const scanner = createJsonRecordScanner();
  const records = [];
  const lines = [];
  for (const event of [...scanner.write(output || ''), ...scanner.flush()]) {
    if (event.type === 'json') {
      records.push(event.value);
    } else if (event.type === 'text') {
      lines.push(event.value);
    }
  }
  return { records, lines };
}

/**
 * Text to scan for usage limits: plain lines stay raw, JSON records become
 * their string values (one per line), and tool output is left out.
 * @param {Object} options - Options
 * @param {string} [options.plainOutput] - Raw output
 * @param {Object[]} [options.messages] - Parsed messages (used without raw output)
 * @returns {string}
 */
export function limitScanText({ plainOutput = '', messages = [] }) {
  const { records, lines } = splitOutput(plainOutput);
  const { debugLines } = classifyDebugLines(lines);
  const strings = lines.filter((_, index) => !debugLines.has(index));
  const events = plainOutput.trim() ? records : messages;
  for (const record of events.flatMap((value) =>
    Array.isArray(value) ? value : [value]
  )) {
    if (!isToolOutputEvent(record)) {
      collectStrings(record, strings);
    }
  }
  return strings.join('\n');
}

const findLast = (messages, predicate) =>
  [...messages].reverse().find((message) => predicate(message)) || null;

/**
 * Detect a usage limit from every source a run leaves behind
 * @param {Object} options - Options
 * @param {string} [options.plainOutput] - Raw output
 * @param {Object[]} [options.messages] - Main-thread messages
 * @returns {{reached: boolean, throttled: boolean, resetTime: string|null, timezone: string|null, resetsAt: number|null, window: string|null}}
 */
export function detectUsageLimitSources({ plainOutput = '', messages = [] }) {
  const text = limitScanText({ plainOutput, messages });
  const { lines } = splitOutput(plainOutput);
  const debug = classifyDebugLines(lines).verdict;
  const rateLimitEvent = classifyRateLimitEvent(
    findLast(messages, (event) => event?.type === 'rate_limit_event')
      ?.rate_limit_info
  );
  const result = findLast(messages, (event) => event?.type === 'result');
  const textReached = isUsageLimitText(text);
  const apiUsageLimit = result?.api_error === 'usage_limit_reached';
  const structured = [rateLimitEvent, debug].find((verdict) => verdict.reached);
  const reached = textReached || apiUsageLimit || Boolean(structured);

  if (!reached) {
    return {
      reached: false,
      throttled:
        rateLimitEvent.throttled ||
        THROTTLE_PATTERN.test(text) ||
        result?.api_error_status === 429,
      resetTime: null,
      timezone: null,
      resetsAt: null,
      window: null,
    };
  }

  // An epoch is exact; "resets 11am" lacks the date of a weekly window.
  const resetTime = structured?.resetTime || extractResetTime(text);
  const rawReset = RAW_RESET_TIME_PATTERNS.map((pattern) =>
    cleanResetTime(text.match(pattern)?.[1])
  ).find(Boolean);
  return {
    reached: true,
    throttled: false,
    resetTime: resetTime || null,
    timezone: structured
      ? 'UTC'
      : resetTime
        ? extractTimezone(text, rawReset)
        : null,
    resetsAt: structured?.resetsAt ?? null,
    window: structured?.window ?? null,
  };
}
