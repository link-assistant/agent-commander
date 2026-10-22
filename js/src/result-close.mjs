/**
 * Close a process that lingers after its final result (hive-mind#1280, #3015).
 *
 * Claude Code can keep running after it wrote its `result` event: an MCP
 * server or a background task holds it open. Hive Mind waits a bounded time
 * (`HIVE_MIND_RESULT_STREAM_CLOSE_MS`) and then stops the process itself. The
 * stop is the caller's own signal, so the run is still judged by its result.
 */

import { trackBackgroundTasks } from './background-tasks.mjs';
import { completionState } from './completion.mjs';
import { createJsonRecordScanner } from './streaming/json-records.mjs';

export const DEFAULT_RESULT_POLL_MS = 100;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

/**
 * Read stream events incrementally from a growing stdout buffer
 * @param {Function} readStdout - Returns the stdout collected so far
 * @returns {Function} Returns every event parsed so far
 */
export function createStdoutMessageReader(readStdout) {
  const scanner = createJsonRecordScanner();
  const messages = [];
  let scanned = 0;
  return () => {
    const stdout = readStdout() || '';
    if (stdout.length > scanned) {
      for (const event of scanner.write(stdout.slice(scanned))) {
        if (event.type === 'json') {
          messages.push(
            ...(Array.isArray(event.value) ? event.value : [event.value])
          );
        }
      }
      scanned = stdout.length;
    }
    return messages;
  };
}

/**
 * Whether the main thread has ended its turn with a final result
 * @param {string} tool - Tool name
 * @param {Object[]} messages - Stream events
 * @returns {boolean}
 */
export function hasFinalResult(tool, messages) {
  const state = completionState(tool, messages);
  return state === 'completed' || state === 'failed';
}

/**
 * Wait for a process to exit, stopping it when it outlives its result
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {Function} options.waitForExit - Resolves with the exit code
 * @param {Function} options.terminate - Stops the process group
 * @param {Function} options.readMessages - Returns the events seen so far
 * @param {number} [options.closeTimeoutMs] - Time the process may stay after
 *   its result once no background task runs; not finite waits forever
 * @param {number} [options.backgroundWaitMs=Infinity] - Extra time granted
 *   while background tasks still run; not finite leaves them to the tool's
 *   own ceiling
 * @param {number} [options.pollMs] - Poll interval
 * @returns {Promise<{exitCode: number, terminatedAfterResult: boolean}>}
 */
export async function waitForExitAfterResult({
  tool,
  waitForExit,
  terminate,
  readMessages,
  closeTimeoutMs,
  backgroundWaitMs = Infinity,
  pollMs = DEFAULT_RESULT_POLL_MS,
}) {
  const exit = waitForExit();
  if (!Number.isFinite(closeTimeoutMs)) {
    return { exitCode: await exit, terminatedAfterResult: false };
  }

  let exited = false;
  exit.then(
    () => {
      exited = true;
    },
    () => {
      exited = true;
    }
  );
  let resultAt = null;
  let idleAt = null;
  while (!exited) {
    await Promise.race([exit, delay(pollMs)]);
    if (exited) {
      break;
    }
    const messages = readMessages();
    if (!hasFinalResult(tool, messages)) {
      resultAt = null;
      idleAt = null;
      continue;
    }
    const now = Date.now();
    resultAt ??= now;
    const running = trackBackgroundTasks(messages).running.length > 0;
    idleAt = running ? null : (idleAt ?? now);
    const idleExpired = idleAt !== null && now - idleAt >= closeTimeoutMs;
    const backgroundExpired =
      Number.isFinite(backgroundWaitMs) &&
      now - resultAt >= backgroundWaitMs + closeTimeoutMs;
    if (idleExpired || backgroundExpired) {
      terminate();
      return { exitCode: await exit, terminatedAfterResult: true };
    }
  }
  return { exitCode: await exit, terminatedAfterResult: false };
}
