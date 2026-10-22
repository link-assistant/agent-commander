/**
 * Probe the installed CLI version of a tool (issue #57). hive-mind reports
 * `<tool> --version` in its status output and upcomputer gates providers on
 * a supported version range, so both need the same probe and comparison.
 */

import { executeCommand } from './executor.mjs';
import { getTool } from './tools/index.mjs';
import { escapeArg } from './tools/shell.mjs';

const VERSION_PATTERN = /\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)/;
const NOT_FOUND_EXIT_CODES = new Set([126, 127]);

/**
 * Build the `<executable> --version` command for a tool.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {string} [options.executable] - Executable path/name override
 * @returns {string} Shell command (stderr is merged into stdout)
 */
export function buildVersionCommand({ tool, executable }) {
  const binary = executable || getTool({ toolName: tool }).executable;
  return `${escapeArg(binary)} --version 2>&1`;
}

/**
 * Extract the first semantic version from `--version` output, such as
 * `2.1.308 (Claude Code)` or `codex-cli 0.163.0`.
 * @param {string} output - Command output
 * @returns {string|null} Version without a leading `v`
 */
export function parseToolVersion(output) {
  return VERSION_PATTERN.exec(String(output || ''))?.[1] || null;
}

/**
 * Split a version into numeric parts and an optional prerelease tag.
 * @param {string} version - Version
 * @returns {{parts: number[], prerelease: string|null}} Parsed version
 */
function splitVersion(version) {
  const match = /^v?(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?/.exec(
    String(version).trim()
  );
  if (!match) {
    throw new Error(`Invalid version "${version}"`);
  }
  return {
    parts: match[1].split('.').map(Number),
    prerelease: match[2] || null,
  };
}

/**
 * Compare two versions numerically; a prerelease sorts before its release.
 * Missing parts count as zero, so `1.2` equals `1.2.0`.
 * @param {string} a - First version
 * @param {string} b - Second version
 * @returns {number} -1, 0 or 1
 */
export function compareVersions(a, b) {
  const left = splitVersion(a);
  const right = splitVersion(b);
  const length = Math.max(left.parts.length, right.parts.length);
  for (let index = 0; index < length; index++) {
    const diff = (left.parts[index] || 0) - (right.parts[index] || 0);
    if (diff !== 0) {
      return Math.sign(diff);
    }
  }
  if (left.prerelease === right.prerelease) {
    return 0;
  }
  if (!left.prerelease || !right.prerelease) {
    return left.prerelease ? -1 : 1;
  }
  return left.prerelease < right.prerelease ? -1 : 1;
}

/**
 * Interpret a finished `--version` probe.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {number} options.exitCode - Probe exit code
 * @param {string} [options.output] - Probe output
 * @param {string} [options.minimumVersion] - Lowest accepted version
 * @returns {{tool: string, installed: boolean, version: string|null, raw: string, meetsMinimum: boolean|null}}
 */
export function toolVersionFromOutput({
  tool,
  exitCode,
  output = '',
  minimumVersion,
}) {
  const raw = String(output).trim();
  const installed = !NOT_FOUND_EXIT_CODES.has(exitCode);
  const version = exitCode === 0 ? parseToolVersion(raw) : null;
  const meetsMinimum =
    minimumVersion === undefined || minimumVersion === null
      ? null
      : version !== null && compareVersions(version, minimumVersion) >= 0;
  return { tool, installed, version, raw, meetsMinimum };
}

/**
 * Run `<tool> --version` and report the installed version.
 * @param {Object} options - Options
 * @param {string} options.tool - Tool name
 * @param {string} [options.executable] - Executable path/name override
 * @param {string} [options.minimumVersion] - Lowest accepted version
 * @param {Function} [options.execute] - Command runner (injectable for tests)
 * @returns {Promise<{tool: string, installed: boolean, version: string|null, raw: string, meetsMinimum: boolean|null}>}
 */
export async function getToolVersion({
  tool,
  executable,
  minimumVersion,
  execute = executeCommand,
}) {
  const command = buildVersionCommand({ tool, executable });
  const { exitCode, stdout } = await execute(command, { attached: false });
  return toolVersionFromOutput({
    tool,
    exitCode,
    output: stdout,
    minimumVersion,
  });
}
