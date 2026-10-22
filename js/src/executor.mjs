/**
 * Execute commands using the runtime's Node-compatible child_process API.
 */

import { constants } from 'node:os';

/** Default delay before a SIGTERM is escalated to SIGKILL. */
export const DEFAULT_KILL_AFTER_MS = 5000;

/**
 * Default bound for the pipes to close once the wrapper shell has exited. A
 * backgrounded grandchild (Claude Bash tasks, MCP servers) can hold stdout
 * open for hours after the CLI itself is gone (hive-mind#3015).
 */
export const DEFAULT_PIPE_DRAIN_MS = 5000;

/**
 * Normalize a child exit into the shell convention: a signal becomes
 * 128 + its number, and 128 + N names the signal a pipeline reported
 * (hive-mind `normalizeCodexExit`).
 * @param {Object} exit - Raw exit
 * @param {number|null} [exit.code] - Exit code reported by the runtime
 * @param {string|null} [exit.signal] - Signal name reported by the runtime
 * @returns {{exitCode: number, signal: string|null}} Normalized exit
 */
export function normalizeExit({ code = null, signal = null } = {}) {
  const signalNumber = signal ? constants.signals[signal] : undefined;
  const exitCode = signalNumber
    ? 128 + signalNumber
    : Number.isInteger(code)
      ? code
      : 1;
  return { exitCode, signal: signal || signalFromExitCode(exitCode) };
}

/**
 * Name the signal behind an exit code of 128 + N.
 * @param {number} exitCode - Exit code
 * @returns {string|null} Signal name such as SIGKILL
 */
export function signalFromExitCode(exitCode) {
  if (!Number.isInteger(exitCode) || exitCode <= 128) {
    return null;
  }
  const entry = Object.entries(constants.signals).find(
    ([, number]) => exitCode === 128 + number
  );
  return entry?.[0] || null;
}

/**
 * True while any process in the group led by `pid` is alive. Signal 0 only
 * checks existence; EPERM means the group exists but belongs to someone else.
 * @param {number} pid - Process group leader
 * @param {Function} [kill] - Injectable for tests
 * @returns {boolean} Whether the group is alive
 */
export function isProcessGroupAlive(pid, kill = process.kill.bind(process)) {
  if (!pid || process.platform === 'win32') {
    return false;
  }
  try {
    kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

/**
 * Execute a command and return the result
 * @param {string} command - Command to execute
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.dryRun] - If true, just return the command without executing
 * @param {boolean} [options.attached] - If true, stream output to console
 * @param {Function} [options.onStdout] - Callback for stdout chunks
 * @param {Function} [options.onStderr] - Callback for stderr chunks
 * @param {Function} [options.onExit] - Callback for exit code
 * @returns {Promise<{exitCode: number, signal: string|null, stdout: string, stderr: string}>} Execution result
 */
export async function executeCommand(command, options = {}) {
  const {
    dryRun = false,
    attached = true,
    onStdout,
    onStderr,
    onExit,
  } = options;

  if (dryRun) {
    console.log('Dry run - command that would be executed:');
    console.log(command);
    return { exitCode: 0, signal: null, stdout: '', stderr: '', command };
  }

  const handle = await startCommand(command, {
    attached,
    onStdout,
    onStderr,
  });
  const exitCode = await handle.waitForExit();
  const { stdout, stderr, signal } = handle.getOutput();

  if (onExit) {
    onExit(exitCode);
  }

  return { exitCode, signal, stdout, stderr, command };
}

/**
 * Start a command execution without waiting for completion
 * @param {string} command - Command to execute
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.attached] - If true, stream output to console
 * @param {boolean} [options.pipeStdin] - If true, open the child's stdin as a
 *   writable pipe (used by the per-command approval relay to send the prompt
 *   and permission responses as NDJSON frames)
 * @param {number} [options.pipeDrainMs] - After the wrapper shell exits, wait
 *   this long for the pipes to close, then kill what is left of the process
 *   group and resolve (default {@link DEFAULT_PIPE_DRAIN_MS})
 * @returns {Promise<Object>} Process handle with methods to interact with the process
 */
export async function startCommand(command, options = {}) {
  const {
    attached = true,
    onStdout,
    onStderr,
    pipeStdin = false,
    pipeDrainMs = DEFAULT_PIPE_DRAIN_MS,
  } = options;
  const { spawn } = await import('node:child_process');

  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let signal = null;
  let hasExited = false;
  let resolveExit;
  let drainTimer = null;
  const killTimers = new Set();

  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const child = spawn('bash', ['-c', command], {
    detached: process.platform !== 'win32',
    stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');

  child.stdout.on('data', (chunk) => {
    const data = chunk.toString();
    stdout += data;
    if (attached) {
      process.stdout.write(data);
    }
    if (onStdout) {
      onStdout(data);
    }
  });

  child.stderr.on('data', (chunk) => {
    const data = chunk.toString();
    stderr += data;
    if (attached) {
      process.stderr.write(data);
    }
    if (onStderr) {
      onStderr(data);
    }
  });

  const finish = (exit) => {
    if (hasExited) {
      return;
    }
    ({ exitCode, signal } = normalizeExit(exit));
    hasExited = true;
    clearTimeout(drainTimer);
    resolveExit(exitCode);
  };

  const signalGroup = (name) => {
    try {
      if (process.platform !== 'win32') {
        process.kill(-child.pid, name);
      } else {
        child.kill(name);
      }
    } catch (error) {
      if (error.code !== 'ESRCH') {
        throw error;
      }
    }
  };

  child.on('error', (error) => {
    if (!hasExited) {
      stderr += error.message;
      if (attached) {
        process.stderr.write(error.message);
      }
      finish({ code: 1 });
    }
  });

  // The wrapper exited; a grandchild may still hold the pipes open. Bound the
  // wait, then stop the rest of the group so the caller is never stuck.
  child.on('exit', (code, exitSignal) => {
    if (hasExited || !(pipeDrainMs >= 0) || !Number.isFinite(pipeDrainMs)) {
      return;
    }
    drainTimer = setTimeout(() => {
      if (isProcessGroupAlive(child.pid)) {
        signalGroup('SIGKILL');
      }
      child.stdout.destroy();
      child.stderr.destroy();
      finish({ code, signal: exitSignal });
    }, pipeDrainMs);
    drainTimer.unref?.();
  });

  child.on('close', (code, exitSignal) => {
    for (const timer of killTimers) {
      clearTimeout(timer);
    }
    finish({ code, signal: exitSignal });
  });

  // Give the stream a moment to start
  await Promise.resolve();

  return {
    command,
    waitForExit: () => exitPromise,
    getOutput: () => ({ stdout, stderr, exitCode, signal, hasExited }),
    process: child,
    /**
     * Signal the whole process group, then escalate to SIGKILL. The group is
     * checked instead of the wrapper shell: the CLI and its background tasks
     * can outlive `bash -c` (hive-mind#3015).
     * @param {string} [name] - Signal to send first
     * @param {Object} [terminateOptions] - Options
     * @param {number|null} [terminateOptions.killAfterMs] - Delay before
     *   SIGKILL; null disables the escalation
     * @returns {boolean} True when a signal was sent
     */
    terminate: (
      name = 'SIGTERM',
      { killAfterMs = DEFAULT_KILL_AFTER_MS } = {}
    ) => {
      const alive =
        process.platform === 'win32'
          ? child.exitCode === null && child.signalCode === null
          : isProcessGroupAlive(child.pid);
      if (!alive) {
        return false;
      }
      signalGroup(name);
      if (name !== 'SIGKILL' && Number.isFinite(killAfterMs)) {
        const timer = setTimeout(() => {
          killTimers.delete(timer);
          if (
            process.platform === 'win32'
              ? child.exitCode === null
              : isProcessGroupAlive(child.pid)
          ) {
            signalGroup('SIGKILL');
          }
        }, killAfterMs);
        timer.unref?.();
        killTimers.add(timer);
      }
      return true;
    },
    /**
     * Write a chunk to the child's stdin (no-op if stdin is not piped/open).
     * @param {string} data - Data to write
     * @returns {boolean} True when the write was attempted
     */
    writeStdin: (data) => {
      if (child.stdin && child.stdin.writable) {
        child.stdin.write(data);
        return true;
      }
      return false;
    },
    /**
     * Close the child's stdin (signals end-of-input).
     */
    endStdin: () => {
      if (child.stdin && !child.stdin.destroyed) {
        child.stdin.end();
      }
    },
  };
}

/**
 * Execute a command in the background (detached)
 * @param {string} command - Command to execute
 * @returns {Promise<{pid: number|null}>} Process information
 */
export async function executeDetached(command) {
  const { spawn } = await import('node:child_process');

  return new Promise((resolve, reject) => {
    try {
      const child = spawn('bash', ['-c', command], {
        detached: true,
        stdio: 'ignore',
      });

      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve({ pid: child.pid });
      });
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Setup CTRL+C handler for graceful shutdown
 * @param {Function} cleanupFn - Function to call on CTRL+C
 * @returns {Function} Function to remove the handler
 */
export function setupSignalHandler(cleanupFn) {
  // Detect runtime
  const isDeno = typeof Deno !== 'undefined';
  const isNode =
    typeof process !== 'undefined' && process.versions && process.versions.node;

  if (isDeno) {
    // Deno signal handling
    const handler = async () => {
      console.log('\nReceived SIGINT, shutting down gracefully...');
      try {
        await cleanupFn();
      } catch (error) {
        console.error('Error during cleanup:', error.message);
      }
      Deno.exit(0);
    };

    // Listen for SIGINT in Deno
    Deno.addSignalListener('SIGINT', handler);

    return () => {
      try {
        Deno.removeSignalListener('SIGINT', handler);
      } catch {
        // Signal listener may already be removed
      }
    };
  } else if (isNode) {
    // Node.js signal handling
    const handler = async (signal) => {
      console.log(`\nReceived ${signal}, shutting down gracefully...`);
      try {
        await cleanupFn();
      } catch (error) {
        console.error('Error during cleanup:', error.message);
      }
      process.exit(0);
    };

    process.on('SIGINT', handler);
    process.on('SIGTERM', handler);

    return () => {
      process.off('SIGINT', handler);
      process.off('SIGTERM', handler);
    };
  }

  // Return no-op for other runtimes
  return () => {};
}
