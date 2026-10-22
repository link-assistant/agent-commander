/**
 * Normalized usage windows (issue #57).
 *
 * Claude Code streams `rate_limit_event.rate_limit_info` (one window per
 * event, `utilization` as a 0-1 fraction). Codex reports
 * `rate_limits.{primary,secondary}` in rollout `token_count` events
 * (`used_percent`, `window_minutes`, `resets_at`) and in app-server
 * `account/rateLimits/*` (`usedPercent`, `windowDurationMins`, `resetsAt`).
 * Both become `{id, kind, label, usedPercent, resetsAt, windowDurationMins}`,
 * the shape upcomputer (`providerUsageLimits.ts`) and hive-mind's limit
 * reports need. `resetsAt` stays in epoch seconds like `limitResetsAt`.
 */

const SESSION_MINS = 5 * 60;
const WEEK_MINS = 7 * 24 * 60;
const MONTH_MINS = 30 * 24 * 60;

/** Window kinds, shortest first. */
export const USAGE_WINDOW_KINDS = ['session', 'weekly', 'monthly', 'other'];

const LABELS = {
  session: 'Session',
  weekly: 'Weekly',
  monthly: 'Monthly',
  other: 'Other',
};

const finite = (value) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

/**
 * Clamp to 0-100 and round to 4 decimals (0.41 * 100 is 41.00000000000001).
 * @param {number} value - Percentage
 * @returns {number} Clamped percentage
 */
function clampPercent(value) {
  return Math.round(Math.max(0, Math.min(100, value)) * 1e4) / 1e4;
}

const epochSeconds = (value) => {
  const number = finite(value);
  return number !== null && number > 0 ? number : null;
};

function makeWindow({ id, kind, label, usedPercent, resetsAt, mins }) {
  return {
    id,
    kind,
    label: label || LABELS[kind],
    usedPercent: clampPercent(usedPercent),
    resetsAt: epochSeconds(resetsAt),
    windowDurationMins: mins ?? null,
  };
}

/**
 * Normalize one Claude `rate_limit_info`. `five_hour` is the session window
 * and every `seven_day*` type (all models, per-model, overage-included) is a
 * weekly window keyed by its own type.
 * @param {Object} info - `rate_limit_event.rate_limit_info`
 * @returns {Object[]} Zero or one window
 */
export function claudeRateLimitWindows(info) {
  const type = info?.rateLimitType;
  const utilization = finite(info?.utilization);
  if (typeof type !== 'string' || !type || utilization === null) {
    return [];
  }
  const resetsAt = info.resetsAt;
  const usedPercent = utilization * 100;
  if (type.startsWith('five_hour')) {
    return [
      makeWindow({
        id: type,
        kind: 'session',
        usedPercent,
        resetsAt,
        mins: SESSION_MINS,
      }),
    ];
  }
  if (type.startsWith('seven_day')) {
    const scope = type.slice('seven_day'.length).replace(/^_/, '');
    return [
      makeWindow({
        id: type,
        kind: 'weekly',
        label: scope ? `Weekly · ${scope}` : 'Weekly',
        usedPercent,
        resetsAt,
        mins: WEEK_MINS,
      }),
    ];
  }
  return [
    makeWindow({ id: type, kind: 'other', label: type, usedPercent, resetsAt }),
  ];
}

const kindForMinutes = (mins) =>
  mins >= MONTH_MINS ? 'monthly' : mins >= WEEK_MINS ? 'weekly' : 'session';

/**
 * Normalize a Codex `rate_limits` snapshot (rollout snake_case or app-server
 * camelCase). `primary` / `secondary` are positions, not durations: without
 * a window length, paid plans mean 5 hours / 1 week and Free or Go plans a
 * monthly primary allowance. Snapshots of another `limit_id` (a model
 * specific allowance) are skipped so they do not replace the main windows.
 * @param {Object} snapshot - `rate_limits`
 * @returns {Object[]} Windows
 */
export function codexRateLimitWindows(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    return [];
  }
  const limitId = snapshot.limit_id ?? snapshot.limitId;
  if (limitId && limitId !== 'codex') {
    return [];
  }
  const plan = snapshot.plan_type ?? snapshot.planType;
  const monthlyPlan = plan === 'free' || plan === 'go';
  const positions = [
    ['primary', monthlyPlan ? MONTH_MINS : SESSION_MINS],
    ['secondary', WEEK_MINS],
  ];
  const windows = [];
  for (const [id, fallbackMins] of positions) {
    const window = snapshot[id];
    const usedPercent = finite(window?.used_percent ?? window?.usedPercent);
    if (usedPercent === null) {
      continue;
    }
    const mins =
      finite(window.window_minutes ?? window.windowDurationMins) ??
      fallbackMins;
    windows.push(
      makeWindow({
        id,
        kind: kindForMinutes(mins),
        usedPercent,
        resetsAt: window.resets_at ?? window.resetsAt,
        mins,
      })
    );
  }
  return windows;
}

/**
 * Merge a partial update into known windows by `id`; windows the update
 * omits are kept (Claude names one window per event).
 * @param {Object[]} windows - Known windows
 * @param {Object[]} update - New windows
 * @returns {Object[]} Merged windows, sorted by kind then id
 */
export function mergeUsageWindows(windows = [], update = []) {
  const byId = new Map(windows.map((window) => [window.id, window]));
  for (const window of update) {
    const previous = byId.get(window.id);
    byId.set(window.id, {
      ...window,
      resetsAt: window.resetsAt ?? previous?.resetsAt ?? null,
    });
  }
  return [...byId.values()].sort(
    (a, b) =>
      USAGE_WINDOW_KINDS.indexOf(a.kind) - USAGE_WINDOW_KINDS.indexOf(b.kind) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  );
}

/**
 * The windows one stream message carries, or an empty list.
 * @param {Object} message - Parsed stream or rollout message
 * @returns {Object[]} Windows
 */
export function usageWindowsFromMessage(message) {
  if (!message || typeof message !== 'object') {
    return [];
  }
  if (message.type === 'rate_limit_event') {
    return claudeRateLimitWindows(message.rate_limit_info);
  }
  const snapshot =
    message.rate_limits ??
    message.payload?.rate_limits ??
    message.params?.rateLimits ??
    message.rateLimits;
  return codexRateLimitWindows(snapshot);
}

/**
 * Fold every usage window a run reported, newest value per window.
 * @param {Object[]} messages - Parsed messages in stream order
 * @returns {Object[]} Windows
 */
export function extractUsageWindows(messages = []) {
  return (Array.isArray(messages) ? messages : []).reduce(
    (windows, message) =>
      mergeUsageWindows(windows, usageWindowsFromMessage(message)),
    []
  );
}
