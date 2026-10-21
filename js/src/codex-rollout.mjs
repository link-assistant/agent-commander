/**
 * Codex rollouts (hive-mind#2888, #3570).
 *
 * Codex writes each thread to
 * `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<thread id>.jsonl`.
 * `codex exec resume <id>` reads only that directory, so a run in a fresh
 * container or `CODEX_HOME` cannot resume a thread whose rollout is missing.
 *
 * `codex exec --json` does not always report a usage limit on stdout or
 * stderr. The rollout keeps two more sources: `event_msg` `token_count` with
 * `rate_limits.{primary,secondary}` (`used_percent`, `window_minutes`,
 * `resets_at` epoch seconds), and `event_msg` `error` with
 * `codex_error_info` `usage_limit_exceeded` (older Codex versions). Only the
 * last turn is read, so a limit an earlier turn waited out is not reported.
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { formatEpochResetTimeUtc, isUsageLimitText } from './usage-limit.mjs';
import { readFileTail } from './utils/file-tail.mjs';

/** Directory under `CODEX_HOME` that holds the rollouts. */
export const CODEX_SESSIONS_DIRNAME = 'sessions';

/** Bytes read from the end of a rollout. */
export const ROLLOUT_TAIL_BYTES = 1024 * 1024;

// `YYYY/MM/DD` plus slack; the walk never goes deeper.
const MAX_ROLLOUT_SEARCH_DEPTH = 5;
// Only ids of this shape are matched against file names.
const THREAD_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$/u;
const TURN_START_TYPES = new Set(['task_started', 'turn_started']);
const WINDOW_LABELS = { 300: '5-hour', 10080: 'weekly' };

/**
 * Codex `sessions` directory
 * @param {Object} [options] - Options
 * @param {string} [options.codexHome] - `CODEX_HOME`; defaults to the
 *   `CODEX_HOME` environment variable, then `~/.codex`
 * @param {string} [options.homeDir] - Home directory
 * @returns {string}
 */
export function codexSessionsDir({
  codexHome = process.env.CODEX_HOME,
  homeDir = os.homedir(),
} = {}) {
  return path.join(
    codexHome || path.join(homeDir, '.codex'),
    CODEX_SESSIONS_DIRNAME
  );
}

/**
 * Whether `name` is the rollout file of `threadId`
 * @param {string} name - File name
 * @param {string} threadId - Codex thread id
 * @returns {boolean}
 */
export const isCodexRolloutFileName = (name, threadId) =>
  typeof name === 'string' &&
  typeof threadId === 'string' &&
  name.startsWith('rollout-') &&
  name.endsWith(`-${threadId}.jsonl`);

const byNameDescending = (a, b) =>
  a.name < b.name ? 1 : a.name > b.name ? -1 : 0;

/**
 * Find a thread's rollout; the newest date directories are searched first
 * @param {Object} options - Options
 * @param {string} options.sessionsDir - Codex `sessions` directory
 * @param {string} options.threadId - Codex thread id
 * @returns {Promise<string|null>} Rollout path
 */
export async function findCodexRolloutFile({ sessionsDir, threadId } = {}) {
  if (!sessionsDir || !THREAD_ID_PATTERN.test(String(threadId || ''))) {
    return null;
  }
  const walk = async (dir, depth) => {
    const entries = await fs
      .readdir(dir, { withFileTypes: true })
      .catch(() => null);
    if (!entries) {
      return null;
    }
    const sorted = [...entries].sort(byNameDescending);
    const file = sorted.find(
      (entry) => entry.isFile() && isCodexRolloutFileName(entry.name, threadId)
    );
    if (file) {
      return path.join(dir, file.name);
    }
    if (depth >= MAX_ROLLOUT_SEARCH_DEPTH) {
      return null;
    }
    for (const entry of sorted) {
      if (entry.isDirectory()) {
        const found = await walk(path.join(dir, entry.name), depth + 1);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  return await walk(sessionsDir, 0);
}

/**
 * Whether `codex exec resume <threadId>` can find the thread: a run in a new
 * container or `CODEX_HOME` should start a new session instead
 * (hive-mind#2888)
 * @param {Object} options - Options
 * @param {string} options.threadId - Codex thread id
 * @param {string} [options.codexHome] - `CODEX_HOME`
 * @param {string} [options.homeDir] - Home directory
 * @returns {Promise<boolean>}
 */
export async function canResumeCodexSession({
  threadId,
  codexHome,
  homeDir,
} = {}) {
  const sessionsDir = codexSessionsDir({ codexHome, homeDir });
  return Boolean(await findCodexRolloutFile({ sessionsDir, threadId }));
}

const describeWindow = (minutes) =>
  WINDOW_LABELS[minutes] ||
  (Number.isFinite(minutes) && minutes > 0 ? `${minutes}-minute` : 'usage');

/**
 * Classify a rollout `token_count.rate_limits` snapshot. A window is reached
 * at `used_percent >= 100` with a `resets_at`; `rate_limit_reached_type`
 * alone (no reset) stays unclassified.
 * @param {Object} snapshot - `rate_limits`
 * @returns {{reached: boolean, reason: string, resetTime?: string|null, timezone?: string, resetsAt?: number, window?: string}}
 */
export function classifyCodexRateLimitSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return { reached: false, reason: 'no rate_limits snapshot' };
  }
  const windows = ['primary', 'secondary']
    .map((name) => ({ name, ...snapshot[name] }))
    .filter((window) => Number.isFinite(Number(window.used_percent)));
  // The latest reset is when every exhausted window is usable again.
  const reached = windows
    .filter(
      (window) =>
        Number(window.used_percent) >= 100 && Number(window.resets_at) > 0
    )
    .sort((a, b) => Number(b.resets_at) - Number(a.resets_at));
  const reachedType = snapshot.rate_limit_reached_type || null;
  const typeNote = reachedType ? ` (${reachedType})` : '';
  if (reached.length === 0) {
    const peak = windows.length
      ? `peak used_percent ${Math.max(...windows.map((window) => Number(window.used_percent)))}`
      : 'no windows';
    return {
      reached: false,
      reason: `no window at 100% with resets_at (${peak})${typeNote}`,
    };
  }
  const [window] = reached;
  const label = describeWindow(Number(window.window_minutes));
  return {
    reached: true,
    reason: `${window.name} ${label} window at ${window.used_percent}%${typeNote}`,
    resetTime: formatEpochResetTimeUtc(window.resets_at),
    timezone: 'UTC',
    resetsAt: Number(window.resets_at),
    window: label,
  };
}

const isUsageLimitErrorInfo = (info) =>
  Boolean(info) &&
  /usage_limit_exceeded/i.test(
    typeof info === 'string' ? info : JSON.stringify(info)
  );

/**
 * Collect usage-limit facts from a rollout's last turn
 * @param {string} text - Rollout text (JSONL)
 * @returns {{rateLimits: Object|null, errorText: string|null, errorInfo: *}}
 */
export function codexRolloutLimitFacts(text) {
  const facts = { rateLimits: null, errorText: null, errorInfo: null };
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const payload = rolloutEventPayload(lines[i]);
    if (payload && TURN_START_TYPES.has(payload.type)) {
      break;
    }
    if (payload) {
      collectLimitFact(facts, payload);
    }
  }
  return facts;
}

// The `event_msg` payload of one rollout line, if it is one.
function rolloutEventPayload(text) {
  let entry;
  try {
    entry = JSON.parse(text);
  } catch {
    return null;
  }
  if (entry?.type !== 'event_msg') {
    return null;
  }
  return entry.payload && typeof entry.payload === 'object'
    ? entry.payload
    : entry;
}

// Keep the newest rate_limits snapshot and usage-limit error of a turn.
function collectLimitFact(facts, payload) {
  if (payload.type === 'token_count' && payload.rate_limits) {
    facts.rateLimits ??= payload.rate_limits;
  } else if (
    payload.type === 'error' &&
    !facts.errorText &&
    (isUsageLimitErrorInfo(payload.codex_error_info) ||
      isUsageLimitText(String(payload.message || '')))
  ) {
    facts.errorText = String(payload.message || 'usage_limit_exceeded');
    facts.errorInfo = payload.codex_error_info ?? null;
  }
}

/**
 * Read the last turn of a thread's rollout
 * @param {Object} options - Options
 * @param {string} options.threadId - Codex thread id
 * @param {string} [options.codexHome] - `CODEX_HOME`
 * @param {string} [options.homeDir] - Home directory
 * @param {number} [options.maxBytes] - Bytes read from the end
 * @returns {Promise<{found: boolean, rolloutPath?: string, reason?: string, rateLimits?: Object|null, errorText?: string|null, errorInfo?: *}>}
 */
export async function readCodexRolloutLimitFacts({
  threadId,
  codexHome,
  homeDir,
  maxBytes = ROLLOUT_TAIL_BYTES,
} = {}) {
  if (!threadId) {
    return { found: false, reason: 'no thread id' };
  }
  const sessionsDir = codexSessionsDir({ codexHome, homeDir });
  const rolloutPath = await findCodexRolloutFile({ sessionsDir, threadId });
  if (!rolloutPath) {
    return { found: false, reason: `no rollout under ${sessionsDir}` };
  }
  const text = await readFileTail(rolloutPath, maxBytes);
  return { found: true, rolloutPath, ...codexRolloutLimitFacts(text) };
}

/**
 * Usage-limit verdict from a thread's rollout, for a failed Codex exit that
 * did not report the limit itself (hive-mind#3570)
 * @param {Object} options - Options passed to readCodexRolloutLimitFacts
 * @returns {Promise<{reached: boolean, reason: string, resetTime: string|null, timezone: string|null, resetsAt: number|null, window: string|null, rolloutPath: string|null}>}
 */
export async function detectCodexRolloutUsageLimit(options = {}) {
  const facts = await readCodexRolloutLimitFacts(options).catch((error) => ({
    found: false,
    reason: error.message,
  }));
  const none = {
    reached: false,
    resetTime: null,
    timezone: null,
    resetsAt: null,
    window: null,
    rolloutPath: facts.rolloutPath || null,
  };
  if (!facts.found) {
    return { ...none, reason: facts.reason };
  }
  const snapshot = classifyCodexRateLimitSnapshot(facts.rateLimits);
  if (snapshot.reached) {
    return { ...none, ...snapshot };
  }
  if (facts.errorText) {
    return {
      ...none,
      reached: true,
      reason: `rollout error: ${facts.errorText}`,
    };
  }
  return { ...none, reason: snapshot.reason };
}

/**
 * Fill a failed Codex run's usage-limit fields from its rollout when the
 * output did not report the limit. A killed process cannot report one.
 * @param {Object} metadata - Normalized result metadata
 * @param {Object} [options] - Options passed to readCodexRolloutLimitFacts
 * @returns {Promise<Object>} The same metadata
 */
export async function applyCodexRolloutUsageLimit(metadata, options = {}) {
  if (
    metadata?.tool !== 'codex' ||
    metadata.exitCode === 0 ||
    metadata.signal ||
    metadata.limitReached ||
    !metadata.sessionId
  ) {
    return metadata;
  }
  const verdict = await detectCodexRolloutUsageLimit({
    ...options,
    threadId: metadata.sessionId,
  });
  if (verdict.reached) {
    Object.assign(metadata, {
      success: false,
      limitReached: true,
      limitResetTime: verdict.resetTime,
      limitTimezone: verdict.timezone,
      limitResetsAt: verdict.resetsAt,
      limitWindow: verdict.window,
      limitSource: 'codex-rollout',
    });
  }
  return metadata;
}
