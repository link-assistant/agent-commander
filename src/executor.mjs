/**
 * Execute commands using command-stream
 */

import { getCommandStream } from './utils/loader.mjs';

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
  const { dryRun = false, attached = true, onStdout, onStderr, onExit } = options;

  if (dryRun) {
    console.log('Dry run - command that would be executed:');
    console.log(command);
    return { exitCode: 0, stdout: '', stderr: '', command };
  }

  const { $ } = await getCommandStream();
  const commandStream = $`${command}`;

  let stdout = '';
  let stderr = '';
  let exitCode = 0;

  try {
    for await (const chunk of commandStream.stream()) {
      if (chunk.type === 'stdout') {
        stdout += chunk.data;
        if (attached) {
          process.stdout.write(chunk.data);
        }
        if (onStdout) {
          onStdout(chunk.data);
        }
      } else if (chunk.type === 'stderr') {
        stderr += chunk.data;
        if (attached) {
          process.stderr.write(chunk.data);
        }
        if (onStderr) {
          onStderr(chunk.data);
        }
      } else if (chunk.type === 'exit') {
        exitCode = chunk.code;
        if (onExit) {
          onExit(chunk.code);
        }
      }
    }
  } catch (error) {
    console.error('Command execution failed:', error.message);
    exitCode = 1;
    stderr += error.message;
  }

  return { exitCode, stdout, stderr, command };
}

/**
 * Execute a command in the background (detached)
 * @param {string} command - Command to execute
 * @returns {Promise<{pid: number|null}>} Process information
 */
export async function executeDetached(command) {
  const { spawn } = await import('child_process');

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
