//! Probe the installed CLI version of a tool (issue #57).
//!
//! hive-mind reports `<tool> --version` in its status output and upcomputer
//! gates providers on a supported version range, so both need the same probe
//! and comparison.

use crate::executor::execute_command;
use crate::tools::get_tool;
use crate::tools::shell::escape_arg;
use regex::Regex;
use std::cmp::Ordering;
use std::io;
use std::sync::OnceLock;

/// Result of a `--version` probe
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ToolVersion {
    pub tool: String,
    /// False when the shell could not find or run the executable (126/127)
    pub installed: bool,
    /// Parsed version without a leading `v`
    pub version: Option<String>,
    /// Trimmed probe output
    pub raw: String,
    /// Whether `version` reaches the requested minimum; `None` without one
    pub meets_minimum: Option<bool>,
}

fn version_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"\bv?(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)").expect("valid version regex")
    })
}

/// Build the `<executable> --version` command for a tool (stderr merged).
///
/// # Errors
/// Returns an error for an unknown tool.
pub fn build_version_command(tool: &str, executable: Option<&str>) -> Result<String, String> {
    let binary = match executable {
        Some(path) if !path.is_empty() => path.to_string(),
        _ => get_tool(tool)?.executable().to_string(),
    };
    Ok(format!("{} --version 2>&1", escape_arg(&binary)))
}

/// Extract the first semantic version from `--version` output, such as
/// `2.1.308 (Claude Code)` or `codex-cli 0.163.0`.
pub fn parse_tool_version(output: &str) -> Option<String> {
    version_pattern()
        .captures(output)
        .map(|captures| captures[1].to_string())
}

fn split_version(version: &str) -> Result<(Vec<u64>, Option<String>), String> {
    let trimmed = version.trim();
    let trimmed = trimmed.strip_prefix('v').unwrap_or(trimmed);
    let (numbers, prerelease) = match trimmed.split_once('-') {
        Some((numbers, tag)) => (numbers, Some(tag.to_string())),
        None => (trimmed, None),
    };
    let parts: Result<Vec<u64>, _> = numbers.split('.').map(str::parse::<u64>).collect();
    parts
        .map(|parts| (parts, prerelease))
        .map_err(|_| format!("Invalid version \"{version}\""))
}

/// Compare two versions numerically; a prerelease sorts before its release.
/// Missing parts count as zero, so `1.2` equals `1.2.0`.
///
/// # Errors
/// Returns an error when either side is not a dotted numeric version.
pub fn compare_versions(a: &str, b: &str) -> Result<Ordering, String> {
    let (left, left_pre) = split_version(a)?;
    let (right, right_pre) = split_version(b)?;
    for index in 0..left.len().max(right.len()) {
        let order = left
            .get(index)
            .unwrap_or(&0)
            .cmp(right.get(index).unwrap_or(&0));
        if order != Ordering::Equal {
            return Ok(order);
        }
    }
    Ok(match (left_pre, right_pre) {
        (None, None) => Ordering::Equal,
        (Some(_), None) => Ordering::Less,
        (None, Some(_)) => Ordering::Greater,
        (Some(l), Some(r)) => l.cmp(&r),
    })
}

/// Interpret a finished `--version` probe.
pub fn tool_version_from_output(
    tool: &str,
    exit_code: i32,
    output: &str,
    minimum_version: Option<&str>,
) -> ToolVersion {
    let raw = output.trim().to_string();
    let version = if exit_code == 0 {
        parse_tool_version(&raw)
    } else {
        None
    };
    let meets_minimum = minimum_version.map(|minimum| {
        version
            .as_deref()
            .and_then(|found| compare_versions(found, minimum).ok())
            .is_some_and(|order| order != Ordering::Less)
    });
    ToolVersion {
        tool: tool.to_string(),
        installed: exit_code != 126 && exit_code != 127,
        version,
        raw,
        meets_minimum,
    }
}

/// Run `<tool> --version` and report the installed version.
///
/// # Errors
/// Returns an error for an unknown tool or when `bash` cannot be spawned.
pub async fn get_tool_version(
    tool: &str,
    executable: Option<&str>,
    minimum_version: Option<&str>,
) -> io::Result<ToolVersion> {
    let command = build_version_command(tool, executable)
        .map_err(|error| io::Error::new(io::ErrorKind::InvalidInput, error))?;
    let result = execute_command(&command, false, false).await?;
    Ok(tool_version_from_output(
        tool,
        result.exit_code,
        &result.stdout,
        minimum_version,
    ))
}
