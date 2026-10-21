//! Claude Code session transcripts (hive-mind#3570).
//!
//! Claude Code writes each session to
//! `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<cwd slug>/<session id>.jsonl`.
//! When an API error ends a run, the transcript's last conversation entry is
//! a synthetic assistant message with `isApiErrorMessage: true`, even when
//! `--output-format stream-json` printed only a generic failure. Only that
//! last entry is read, so an error an earlier turn recovered from is not
//! reported.

use regex::Regex;
use serde_json::Value;
use std::path::PathBuf;
use std::sync::LazyLock;

use crate::file_tail::{default_home_dir, read_file_tail};
use crate::result_metadata::ResultMetadata;
use crate::usage_limit::{extract_reset_time, extract_timezone, is_usage_limit_text};

/// Bytes read from the end of a transcript
pub const TRANSCRIPT_TAIL_BYTES: u64 = 1024 * 1024;

/// `limit_source` of a limit found in a transcript
pub const CLAUDE_TRANSCRIPT_LIMIT_SOURCE: &str = "claude-transcript";

const CONVERSATION_TYPES: [&str; 2] = ["assistant", "user"];

// Only ids of this shape become file names.
static SESSION_ID_PATTERN: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r"^[0-9a-zA-Z][0-9a-zA-Z_-]{7,127}$").expect("valid session id regex")
});

/// Where to look for Claude transcripts
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeTranscriptOptions {
    /// Directory the session ran in
    pub working_directory: Option<PathBuf>,
    /// `CLAUDE_CONFIG_DIR`; defaults to the environment variable
    pub claude_config_dir: Option<PathBuf>,
    /// Home directory; defaults to `HOME` (`USERPROFILE` on Windows)
    pub home_dir: Option<PathBuf>,
    /// Bytes read from the end; defaults to [`TRANSCRIPT_TAIL_BYTES`]
    pub max_bytes: Option<u64>,
}

impl ClaudeTranscriptOptions {
    /// Options for a run in `working_directory` launched with `extra_env` and
    /// `unset_env`.
    ///
    /// A `CLAUDE_CONFIG_DIR` passed to the run wins; an unset one means
    /// `~/.claude`.
    pub fn for_run_env(
        working_directory: &str,
        extra_env: &[(String, String)],
        unset_env: &[String],
    ) -> Self {
        let passed = extra_env
            .iter()
            .rev()
            .find(|(name, value)| name == "CLAUDE_CONFIG_DIR" && !value.is_empty())
            .map(|(_, value)| PathBuf::from(value));
        let claude_config_dir = passed.or_else(|| {
            unset_env
                .iter()
                .any(|name| name == "CLAUDE_CONFIG_DIR")
                .then(|| default_home_dir().join(".claude"))
        });
        Self {
            working_directory: Some(PathBuf::from(working_directory))
                .filter(|path| !path.as_os_str().is_empty()),
            claude_config_dir,
            ..Self::default()
        }
    }

    fn max_bytes(&self) -> u64 {
        self.max_bytes.unwrap_or(TRANSCRIPT_TAIL_BYTES)
    }
}

/// Project directory names Claude Code uses for a working directory: older
/// versions replace `/`, newer ones every non-alphanumeric character
pub fn claude_project_slugs(working_directory: &str) -> Vec<String> {
    let old = working_directory.replace('/', "-");
    let new: String = working_directory
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect();
    if old == new {
        vec![old]
    } else {
        vec![old, new]
    }
}

/// Transcript paths that may hold a session, most specific first
pub fn claude_transcript_candidates(
    session_id: &str,
    options: &ClaudeTranscriptOptions,
) -> Vec<PathBuf> {
    let Some(working_directory) = options.working_directory.as_deref() else {
        return Vec::new();
    };
    if !SESSION_ID_PATTERN.is_match(session_id) {
        return Vec::new();
    }
    let config_dir = options
        .claude_config_dir
        .clone()
        .filter(|path| !path.as_os_str().is_empty())
        .or_else(|| {
            std::env::var_os("CLAUDE_CONFIG_DIR")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from)
        });
    let home = options.home_dir.clone().unwrap_or_else(default_home_dir);
    let roots = config_dir
        .map(|dir| dir.join("projects"))
        .into_iter()
        .chain(std::iter::once(home.join(".claude").join("projects")));
    let slugs = claude_project_slugs(&working_directory.to_string_lossy());
    let mut candidates: Vec<PathBuf> = Vec::new();
    for root in roots {
        for slug in &slugs {
            let path = root.join(slug).join(format!("{session_id}.jsonl"));
            if !candidates.contains(&path) {
                candidates.push(path);
            }
        }
    }
    candidates
}

/// The API error that ended a transcript
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ClaudeTranscriptApiError {
    /// Text blocks of the error message, joined by newlines
    pub text: String,
    /// `error` field (`rate_limit`, ...)
    pub error: Option<Value>,
    /// `timestamp` field
    pub timestamp: Option<String>,
}

/// The API error that ended a transcript, if its last conversation entry is
/// one; otherwise why not.
pub fn claude_transcript_api_error(text: &str) -> Result<ClaudeTranscriptApiError, String> {
    for line in text.lines().rev() {
        let Ok(entry) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        // Summaries, queue operations and system notes are not conversation.
        let Some(kind) = entry
            .get("type")
            .and_then(Value::as_str)
            .filter(|kind| CONVERSATION_TYPES.contains(kind))
        else {
            continue;
        };
        if kind != "assistant" || entry.get("isApiErrorMessage") != Some(&Value::Bool(true)) {
            return Err(format!("last entry is a {kind} message, not an API error"));
        }
        let text = entry
            .pointer("/message/content")
            .and_then(Value::as_array)
            .map(|content| {
                content
                    .iter()
                    .filter(|item| item.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|item| item.get("text").and_then(Value::as_str))
                    .filter(|text| !text.is_empty())
                    .collect::<Vec<_>>()
                    .join("\n")
            })
            .unwrap_or_default();
        return Ok(ClaudeTranscriptApiError {
            text,
            error: entry.get("error").filter(|value| !value.is_null()).cloned(),
            timestamp: entry
                .get("timestamp")
                .and_then(Value::as_str)
                .map(String::from),
        });
    }
    Err("no conversation entry in transcript tail".to_string())
}

/// Read the API error that ended a Claude session.
///
/// Returns the transcript path and the error, or why none was found.
pub fn read_claude_transcript_api_error(
    session_id: &str,
    options: &ClaudeTranscriptOptions,
) -> Result<(PathBuf, ClaudeTranscriptApiError), String> {
    if session_id.is_empty() || options.working_directory.is_none() {
        return Err("no session id".to_string());
    }
    for path in claude_transcript_candidates(session_id, options) {
        if let Ok(text) = read_file_tail(&path, options.max_bytes()) {
            return claude_transcript_api_error(&text).map(|error| (path, error));
        }
    }
    Err("transcript not found".to_string())
}

fn is_claude_transcript_candidate(metadata: &ResultMetadata) -> bool {
    metadata.tool == "claude"
        && !metadata.success
        && metadata.signal.is_none()
        && !metadata.limit_reached
        && metadata
            .session_id
            .as_deref()
            .is_some_and(|id| !id.is_empty())
}

/// Fill a failed Claude run's usage-limit fields from its transcript when the
/// output did not report the limit. A killed process cannot report one.
///
/// Returns whether a limit was found.
pub fn apply_claude_transcript_usage_limit(
    metadata: &mut ResultMetadata,
    options: &ClaudeTranscriptOptions,
) -> bool {
    if !is_claude_transcript_candidate(metadata) {
        return false;
    }
    let session_id = metadata.session_id.clone().unwrap_or_default();
    let Ok((_, transcript)) = read_claude_transcript_api_error(&session_id, options) else {
        return false;
    };
    if !is_usage_limit_text(&transcript.text) {
        return false;
    }
    let reset_time = extract_reset_time(&transcript.text);
    metadata.success = false;
    metadata.limit_reached = true;
    metadata.limit_timezone = extract_timezone(&transcript.text, reset_time.as_deref());
    metadata.limit_reset_time = reset_time;
    metadata.limit_source = Some(CLAUDE_TRANSCRIPT_LIMIT_SOURCE.to_string());
    true
}
