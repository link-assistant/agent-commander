/**
 * Claude Code background tasks and print-mode turns (hive-mind#2301, #3015).
 *
 * After the main thread goes idle, `claude -p` waits for background tasks
 * (Agent, or Bash with `run_in_background`) up to
 * `CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS`, then writes
 * "Background tasks still running after 600s; terminating" to stderr and
 * stops every task. The `result` event still says `success`, but the work
 * is unfinished, so the run is incomplete and should be resumed.
 */

export const PRINT_BG_CEILING_PATTERN =
  /Background tasks still running after (\d+)s; terminating/;

const TERMINAL_TASK_STATUSES = new Set([
  'completed',
  'failed',
  'killed',
  'stopped',
  'cancelled',
  'error',
]);

const isMainThread = (event) =>
  !(
    typeof event?.parent_tool_use_id === 'string' &&
    event.parent_tool_use_id.length > 0
  );

// Apply one `system` task event to the tracker state.
function applyTaskEvent(state, event) {
  const id = event.task_id;
  if (event.subtype === 'task_started' && id) {
    if (event.description) {
      state.descriptions.set(id, event.description);
    }
    if (event.is_backgrounded === true) {
      state.add(id, event.task_type, event.description);
    }
  } else if (
    event.subtype === 'background_tasks_changed' &&
    Array.isArray(event.tasks)
  ) {
    state.tasks = new Map();
    for (const task of event.tasks) {
      if (task?.task_id) {
        state.add(task.task_id, task.task_type, task.description);
      }
    }
  } else if (event.subtype === 'task_updated' && id) {
    const patch = event.patch || {};
    if (TERMINAL_TASK_STATUSES.has(patch.status)) {
      state.tasks.delete(id);
    } else if (patch.is_backgrounded === true) {
      state.add(id, null, null);
    }
  } else if (event.subtype === 'task_notification') {
    if (id) {
      state.tasks.delete(id);
    }
    if (event.status === 'stopped') {
      const stoppedId =
        id || event.tool_use_id || `stopped-${state.stopped.size + 1}`;
      state.stopped.set(stoppedId, {
        id: stoppedId,
        summary: event.summary || null,
        outputFile: event.output_file || null,
      });
    }
  }
}

/**
 * Follow background tasks and the print-mode turn over a message list.
 * `background_tasks_changed` carries the authoritative list; `task_started`,
 * `task_updated` and `task_notification` keep it right for CLI versions that
 * do not send it.
 * @param {Object[]} messages - Parsed stream events
 * @returns {{running: Object[], stoppedTasks: Object[], resultEvent: Object|null, resultCount: number, turnOpen: boolean}}
 *   `running` lists tasks that never reported an end; `stoppedTasks` lists
 *   tasks stopped while the main thread was idle (a stop the model asked for
 *   itself is always followed by a main-thread reply, which clears the list)
 */
export function trackBackgroundTasks(messages = []) {
  const state = {
    tasks: new Map(),
    descriptions: new Map(),
    stopped: new Map(),
    add(id, type, description) {
      const previous = this.tasks.get(id);
      this.tasks.set(id, {
        id,
        type: type || previous?.type || null,
        description:
          description ||
          previous?.description ||
          this.descriptions.get(id) ||
          null,
      });
    },
  };
  let resultEvent = null;
  let resultCount = 0;
  let turnOpen = true;

  for (const event of messages) {
    if (!event || typeof event !== 'object') {
      continue;
    }
    if (event.type === 'assistant' && isMainThread(event)) {
      turnOpen = true;
      state.stopped = new Map();
    } else if (event.type === 'result' && isMainThread(event)) {
      resultEvent = event;
      resultCount++;
      turnOpen = false;
    } else if (event.type === 'system') {
      applyTaskEvent(state, event);
    }
  }

  return {
    running: [...state.tasks.values()],
    stoppedTasks: [...state.stopped.values()],
    resultEvent,
    resultCount,
    turnOpen,
  };
}

/**
 * Read the print-mode wait ceiling from Claude's stderr announcement.
 * @param {string} text - Process output
 * @returns {number|null} Ceiling in seconds
 */
export function printWaitCeilingSeconds(text) {
  const match =
    typeof text === 'string' ? PRINT_BG_CEILING_PATTERN.exec(text) : null;
  return match ? Number(match[1]) : null;
}

/**
 * Decide whether a print-mode turn ended with background work unfinished.
 * @param {Object} options - Inputs
 * @param {Object[]} options.messages - Main-thread and subagent events
 * @param {string} [options.output] - Raw output, scanned for the ceiling line
 * @param {boolean} [options.terminatedAfterResult] - The caller stopped the
 *   process after its result, while tasks may still have been running
 * @returns {{runningBackgroundTasks: Object[], backgroundTasksStopped: number, stoppedBackgroundTasks: Object[], printWaitCeilingSeconds: number|null, incomplete: boolean, cause: string|null}}
 *   Turn assessment
 */
export function assessBackgroundTasks({
  messages = [],
  output = '',
  terminatedAfterResult = false,
} = {}) {
  const state = trackBackgroundTasks(messages);
  const ceilingSeconds = printWaitCeilingSeconds(output);
  const systemKilled =
    Number(state.resultEvent?.subagent_stats?.killed?.system) || 0;
  const cancelledByCaller = terminatedAfterResult ? state.running.length : 0;
  const backgroundTasksStopped = Math.max(
    systemKilled,
    state.stoppedTasks.length,
    cancelledByCaller,
    ceilingSeconds === null ? 0 : 1
  );
  const result = state.resultEvent;
  const incomplete =
    !state.turnOpen &&
    result?.subtype === 'success' &&
    result.is_error !== true &&
    backgroundTasksStopped > 0;
  let cause = null;
  if (incomplete) {
    cause =
      ceilingSeconds !== null
        ? `Claude Code stopped background tasks after its ${ceilingSeconds}s print-mode wait ceiling (CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS)`
        : cancelledByCaller > 0
          ? 'The process was stopped after its result while background tasks were still running'
          : 'Claude Code stopped background tasks when print mode exited';
  }
  return {
    runningBackgroundTasks: state.running,
    backgroundTasksStopped,
    stoppedBackgroundTasks: state.stoppedTasks,
    printWaitCeilingSeconds: ceilingSeconds,
    incomplete,
    cause,
  };
}
