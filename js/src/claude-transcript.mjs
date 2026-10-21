/**
 * Claude Code session transcripts (hive-mind#3570).
 *
 * Claude Code writes each session to
 * `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<cwd slug>/<session id>.jsonl`.
 * When an API error ends a run, the transcript's last conversation entry is
 * a synthetic assistant message with `isApiErrorMessage: true`, even when
 * `--output-format stream-json` printed only a generic failure. Only that
 * last entry is read, so an error an earlier turn recovered from is not
 * reported.
 */

import os from 'node:os';
import path from 'node:path';

import {
  extractResetTime,
  extractTimezone,
  isUsageLimitText,
} from './usage-limit.mjs';
import { readFileTail } from './utils/file-tail.mjs';

/** Bytes read from the end of a transcript. */
export const TRANSCRIPT_TAIL_BYTES = 1024 * 1024;

// Only ids of this shape become file names.
const SESSION_ID_PATTERN = /^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$/u;
const CONVERSATION_TYPES = new Set(['assistant', 'user']);

/**
 * Project directory names Claude Code uses for a working directory: older
 * versions replace `/`, newer ones every non-alphanumeric character
 * @param {string} workingDirectory - Directory the session ran in
 * @returns {string[]}
 */
export const claudeProjectSlugs = (workingDirectory) => [
  ...new Set([
    String(workingDirectory).replace(/\//g, '-'),
    String(workingDirectory).replace(/[^a-zA-Z0-9]/g, '-'),
  ]),
];

/**
 * Transcript paths that may hold a session, most specific first
 * @param {Object} options - Options
 * @param {string} options.workingDirectory - Directory the session ran in
 * @param {string} options.sessionId - Claude session id
 * @param {string} [options.claudeConfigDir] - `CLAUDE_CONFIG_DIR`; defaults
 *   to the environment variable
 * @param {string} [options.homeDir] - Home directory
 * @returns {string[]}
 */
export function claudeTranscriptCandidates({
  workingDirectory,
  sessionId,
  claudeConfigDir = process.env.CLAUDE_CONFIG_DIR,
  homeDir = os.homedir(),
} = {}) {
  if (!workingDirectory || !SESSION_ID_PATTERN.test(String(sessionId || ''))) {
    return [];
  }
  const roots = [
    ...(claudeConfigDir ? [path.join(claudeConfigDir, 'projects')] : []),
    path.join(homeDir, '.claude', 'projects'),
  ];
  return [
    ...new Set(
      roots.flatMap((root) =>
        claudeProjectSlugs(workingDirectory).map((slug) =>
          path.join(root, slug, `${sessionId}.jsonl`)
        )
      )
    ),
  ];
}

/**
 * The API error that ended a transcript, if its last conversation entry is one
 * @param {string} text - Transcript text (JSONL)
 * @returns {{found: boolean, reason?: string, text?: string, error?: *, timestamp?: string|null}}
 */
export function claudeTranscriptApiError(text) {
  const lines = String(text || '').split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    // Summaries, queue operations and system notes are not conversation.
    if (!CONVERSATION_TYPES.has(entry?.type)) {
      continue;
    }
    if (entry.type !== 'assistant' || entry.isApiErrorMessage !== true) {
      return {
        found: false,
        reason: `last entry is a ${entry.type} message, not an API error`,
      };
    }
    const content = Array.isArray(entry.message?.content)
      ? entry.message.content
      : [];
    return {
      found: true,
      text: content
        .filter((item) => item?.type === 'text' && item.text)
        .map((item) => item.text)
        .join('\n'),
      error: entry.error ?? null,
      timestamp: entry.timestamp ?? null,
    };
  }
  return { found: false, reason: 'no conversation entry in transcript tail' };
}

/**
 * Read the API error that ended a Claude session
 * @param {Object} options - Options passed to claudeTranscriptCandidates
 * @param {number} [options.maxBytes] - Bytes read from the end
 * @returns {Promise<{found: boolean, transcriptPath?: string, reason?: string, text?: string, error?: *, timestamp?: string|null}>}
 */
export async function readClaudeTranscriptApiError({
  maxBytes = TRANSCRIPT_TAIL_BYTES,
  ...options
} = {}) {
  if (!options.workingDirectory || !options.sessionId) {
    return { found: false, reason: 'no session id' };
  }
  for (const transcriptPath of claudeTranscriptCandidates(options)) {
    const text = await readFileTail(transcriptPath, maxBytes).catch(() => null);
    if (text !== null) {
      return { transcriptPath, ...claudeTranscriptApiError(text) };
    }
  }
  return { found: false, reason: 'transcript not found' };
}

/**
 * Fill a failed Claude run's usage-limit fields from its transcript when the
 * output did not report the limit. A killed process cannot report one.
 * @param {Object} metadata - Normalized result metadata
 * @param {Object} options - Options passed to readClaudeTranscriptApiError
 *   (`workingDirectory` is required)
 * @returns {Promise<Object>} The same metadata
 */
export async function applyClaudeTranscriptUsageLimit(metadata, options = {}) {
  if (
    metadata?.tool !== 'claude' ||
    metadata.success ||
    metadata.signal ||
    metadata.limitReached ||
    !metadata.sessionId
  ) {
    return metadata;
  }
  const transcript = await readClaudeTranscriptApiError({
    ...options,
    sessionId: metadata.sessionId,
  }).catch(() => ({ found: false }));
  if (transcript.found && isUsageLimitText(transcript.text)) {
    const resetTime = extractResetTime(transcript.text);
    Object.assign(metadata, {
      success: false,
      limitReached: true,
      limitResetTime: resetTime,
      limitTimezone: extractTimezone(transcript.text, resetTime),
      limitSource: 'claude-transcript',
    });
  }
  return metadata;
}
