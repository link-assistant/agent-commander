/**
 * Execute commands using the runtime's Node-compatible child_process API.
 */

/**
 * Execute a command and return the result
 * @param {string} command - Command to execute
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.dryRun] - If true, just return the command without executing
 * @param {boolean} [options.attached] - If true, stream output to console
 * @param {Function} [options.onStdout] - Callback for stdout chunks
 * @param {Function} [options.onStderr] - Callback for stderr chunks
 * @param {Function} [options.onExit] - Callback for exit code
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string}>} Execution result
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
    return { exitCode: 0, stdout: '', stderr: '', command };
  }

  const handle = await startCommand(command, {
    attached,
    onStdout,
    onStderr,
  });
  const exitCode = await handle.waitForExit();
  const { stdout, stderr } = handle.getOutput();

  if (onExit) {
    onExit(exitCode);
  }

  return { exitCode, stdout, stderr, command };
}

/**
 * Start a command execution without waiting for completion
 * @param {string} command - Command to execute
 * @param {Object} [options] - Execution options
 * @param {boolean} [options.attached] - If true, stream output to console
 * @param {boolean} [options.pipeStdin] - If true, open the child's stdin as a
 *   writable pipe (used by the per-command approval relay to send the prompt
 *   and permission responses as NDJSON frames)
 * @returns {Promise<Object>} Process handle with methods to interact with the process
 */
export async function startCommand(command, options = {}) {
  const { attached = true, onStdout, onStderr, pipeStdin = false } = options;
  const { spawn } = await import('node:child_process');

  let stdout = '';
  let stderr = '';
  let exitCode = null;
  let hasExited = false;
  let resolveExit;

  const exitPromise = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const child = spawn('bash', ['-c', command], {
    stdio: [pipeStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'],
  });

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

  child.on('error', (error) => {
    if (!hasExited) {
      stderr += error.message;
      if (attached) {
        process.stderr.write(error.message);
      }
      exitCode = 1;
      hasExited = true;
      resolveExit(1);
    }
  });

  child.on('close', (code) => {
    if (!hasExited) {
      exitCode = code ?? 0;
      hasExited = true;
      resolveExit(exitCode);
    }
  });

  // Give the stream a moment to start
  await Promise.resolve();

  return {
    command,
    waitForExit: () => exitPromise,
    getOutput: () => ({ stdout, stderr, exitCode, hasExited }),
    process: child,
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

      child.unref();

      resolve({ pid: child.pid });
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
