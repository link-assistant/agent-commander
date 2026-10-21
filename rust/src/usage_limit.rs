//! Usage-limit detection shared by every tool's result metadata
//!
//! Ported from Hive Mind `src/usage-limit.lib.mjs` and
//! `src/claude.usage-limit-sources.lib.mjs` (hive-mind#1122, #1290, #1869,
//! #1924, #1935, #2687, #3570). Reset times are normalized to the shapes Hive
//! Mind's `parseResetTime` accepts (`MMM D, YYYY, h:mm A`, `MMM D, h:mm A`,
//! `h:mm A`) so the value can be handed straight back to it.

use crate::streaming::{JsonRecordEvent, JsonRecordScanner};
use regex::{Captures, Regex};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::sync::LazyLock;

const MONTH: &str = "(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)";
const MONTHS: [&str; 12] = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

fn regex(pattern: &str) -> Regex {
    Regex::new(pattern).expect("valid built-in pattern")
}

static USAGE_LIMIT_PATTERNS: LazyLock<Vec<Regex>> = LazyLock::new(|| {
    [
        // "You've hit your usage limit" (Codex), "hit your session/weekly limit" (Claude)
        r"(?i)hit your (?:\w+ )?limit".to_string(),
        r"(?i)you have exceeded your rate limit".to_string(),
        r"(?i)usage limit (?:reached|exceeded)".to_string(),
        // Require an explicit qualifier: header names such as
        // "anthropic-ratelimit-unified-5h-reset" are not a signal (issue #37), and
        // "Rate limited" is a transient server throttle (hive-mind#1924).
        r"(?i)rate[_\s-]?limit[_\s-]?(?:reached|exceeded)".to_string(),
        r"(?i)limit (?:has been )?reached".to_string(),
        r"(?i)billing hard limit".to_string(),
        r"(?i)please try again at".to_string(),
        r"(?i)available again at".to_string(),
        // "resets 5am" / "resets Jan 15, 8am", but not "loads a shell and resets" (hive-mind#1290)
        format!(r"(?i)resets\s+(?:(?:at\s+)?[0-9]|{MONTH}\b)"),
        r"(?i)freeusagelimiterror".to_string(),
    ]
    .iter()
    .map(|pattern| regex(pattern))
    .collect()
});
static THROTTLE: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)not your usage limit"));
static RAW_RESET_TIME_PATTERNS: LazyLock<[Regex; 2]> = LazyLock::new(|| {
    [
        regex(r#"(?i)(?:resets?|try again|available again|available)\s+(?:at|on)?\s*([^\n."]+)"#),
        regex(r#"(?i)(?:reset time|limit resets at)\s*:?\s*([^\n."]+)"#),
    ]
});
static DATE_RESET: LazyLock<Regex> = LazyLock::new(|| {
    regex(&format!(
        r"(?i)({MONTH})\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?,?\s+(?:at\s+)?([0-9]{{1,2}})(?::([0-9]{{2}}))?\s*([ap]m)"
    ))
});
static KEYWORD_RESET: LazyLock<Regex> = LazyLock::new(|| {
    regex(
        r"(?i)(?:try again|available(?: again)?|resets?)(?:\s+at)?\s+([0-9]{1,2})(?::([0-9]{2}))?\s*([ap]m)\b",
    )
});
static RESET_24H: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)resets?(?:\s+at)?\s+([0-2]?[0-9]):([0-5][0-9])"));
static AM_PM_AHEAD: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^\s*[ap]m"));
static TIMEZONE: LazyLock<Regex> = LazyLock::new(|| {
    regex(r"\b(?:UTC(?:[+-]\d{1,2}(?::\d{2})?)?|[A-Z]{2,5}|[A-Za-z]+/[A-Za-z_/-]+)\b")
});
static IANA_PARENTHETICAL: LazyLock<Regex> =
    LazyLock::new(|| regex(r"\(([A-Za-z_]+(?:/[A-Za-z_]+){0,2})\)"));
static PARENTHETICAL: LazyLock<Regex> = LazyLock::new(|| regex(r"\(([^)]+)\)"));
static TIMEZONE_LABEL: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)\btimezone\s*:?\s*([A-Za-z_/-]+|UTC[+-]?\d*)\b"));

// `[log_be123b] response error (error; no more retries left) {` from ANTHROPIC_LOG=debug
static DEBUG_BLOCK_START: LazyLock<Regex> = LazyLock::new(|| regex(r"(?i)^\[log_[0-9a-f]+\]\s"));
static DEBUG_RESPONSE_ERROR: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)^\[log_[0-9a-f]+\]\s+response error\b"));
// The debug logger's compressed body dumps (hive-mind#3570).
static BASE64_DUMP_LINE: LazyLock<Regex> = LazyLock::new(|| regex(r"^[A-Za-z0-9+/=]{120,}$"));
static HEADER_LINE: LazyLock<Regex> =
    LazyLock::new(|| regex(r#"(?i)^\s*"?([a-z0-9-]+)"?\s*:\s*"?([^",]*)"?,?\s*$"#));
static RATE_LIMIT_HEADER: LazyLock<Regex> =
    LazyLock::new(|| regex(r"(?i)^(?:anthropic-ratelimit-.*|retry-after)$"));
static STATUS_LINE: LazyLock<Regex> = LazyLock::new(|| regex(r"^\s*status:\s*(\d{3}),?\s*$"));
static BLOCK_END: LazyLock<Regex> = LazyLock::new(|| regex(r"^}\s*$"));
static BLOCK_OPEN: LazyLock<Regex> = LazyLock::new(|| regex(r"\{\s*$"));

/// Usage-limit verdict for one run
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct UsageLimitVerdict {
    /// An account usage limit was reached
    pub reached: bool,
    /// A transient server throttle (retry, do not wait for a reset)
    pub throttled: bool,
    /// Reset time, normalized for Hive Mind `parseResetTime` when possible
    pub reset_time: Option<String>,
    /// Reset timezone
    pub timezone: Option<String>,
    /// Exact reset epoch (seconds) from a structured source
    pub resets_at: Option<i64>,
    /// Limit window reported by a structured source (`five_hour`, `seven_day`, ...)
    pub window: Option<String>,
}

/// Whether text reports an account usage limit (not a transient throttle)
pub fn is_usage_limit_text(text: &str) -> bool {
    USAGE_LIMIT_PATTERNS
        .iter()
        .any(|pattern| pattern.is_match(text))
}

fn clean_reset_time(value: &str) -> Option<String> {
    let mut cleaned = value
        .trim()
        .trim_end_matches([',', ';', '}', ']'])
        .to_string();
    // Keep "11am (UTC)" but drop the ")" of "(... try again at 5pm)".
    if cleaned.ends_with(')') && !cleaned.contains('(') {
        cleaned = cleaned.trim_end_matches(')').to_string();
    }
    if cleaned.is_empty() || cleaned.chars().count() > 120 {
        return None;
    }
    Some(cleaned)
}

fn twelve_hour(hour: &str, minute: Option<&str>, ampm: &str) -> String {
    format!(
        "{}:{} {}",
        hour,
        minute.unwrap_or("00"),
        ampm.to_uppercase()
    )
}

fn group<'t>(captures: &Captures<'t>, index: usize) -> Option<&'t str> {
    captures.get(index).map(|m| m.as_str())
}

fn raw_reset_time(text: &str) -> Option<String> {
    RAW_RESET_TIME_PATTERNS.iter().find_map(|pattern| {
        pattern
            .captures(text)
            .and_then(|captures| clean_reset_time(group(&captures, 1)?))
    })
}

/// Extract a reset time, normalized like Hive Mind's `extractResetTime`
///
/// Returns e.g. `"Jun 11, 2026, 12:27 AM"`, `"Jan 15, 8:00 AM"`, `"5:00 PM"`;
/// unrecognized shapes such as `"2026-05-01 18:30 UTC"` are kept verbatim.
pub fn extract_reset_time(text: &str) -> Option<String> {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");

    // A calendar date comes first so a weekly reset is never cut to a bare time (hive-mind#1869).
    if let Some(captures) = DATE_RESET.captures(&normalized) {
        let time = twelve_hour(&captures[4], group(&captures, 5), &captures[6]);
        return Some(match group(&captures, 3) {
            Some(year) => format!("{} {}, {}, {}", &captures[1], &captures[2], year, time),
            None => format!("{} {}, {}", &captures[1], &captures[2], time),
        });
    }

    if let Some(captures) = KEYWORD_RESET.captures(&normalized) {
        return Some(twelve_hour(&captures[1], group(&captures, 2), &captures[3]));
    }

    for captures in RESET_24H.captures_iter(&normalized) {
        let rest = &normalized[captures.get(0).map_or(0, |m| m.end())..];
        if AM_PM_AHEAD.is_match(rest)
            || rest.starts_with(|c: char| c == '-' || c == ':' || c.is_ascii_digit())
        {
            continue;
        }
        let hour: u32 = captures[1].parse().unwrap_or(0);
        let hour12 = if hour.is_multiple_of(12) { 12 } else { hour % 12 };
        let ampm = if hour >= 12 { "PM" } else { "AM" };
        return Some(format!("{}:{} {}", hour12, &captures[2], ampm));
    }

    raw_reset_time(&normalized)
}

fn find_timezone(text: &str) -> Option<String> {
    TIMEZONE
        .find_iter(text)
        .map(|m| m.as_str())
        .find(|candidate| *candidate != "AM" && *candidate != "PM")
        .map(ToString::to_string)
}

/// Extract the reset timezone (`"(Europe/Berlin)"`, `"(UTC)"`, `"18:30 UTC"`)
pub fn extract_timezone(text: &str, reset_time: Option<&str>) -> Option<String> {
    if let Some(iana) = IANA_PARENTHETICAL
        .captures(text)
        .and_then(|captures| group(&captures, 1))
    {
        if find_timezone(iana).is_some() {
            return Some(iana.to_string());
        }
    }
    PARENTHETICAL
        .captures(text)
        .and_then(|captures| find_timezone(group(&captures, 1)?))
        .or_else(|| reset_time.and_then(find_timezone))
        .or_else(|| {
            TIMEZONE_LABEL
                .captures(text)
                .and_then(|captures| group(&captures, 1).map(ToString::to_string))
        })
}

/// Format an epoch (seconds) as `MMM D, YYYY, h:mm A` in UTC
pub fn format_epoch_reset_time_utc(epoch_seconds: i64) -> Option<String> {
    if epoch_seconds <= 0 {
        return None;
    }
    let days = epoch_seconds.div_euclid(86_400);
    let seconds_of_day = epoch_seconds.rem_euclid(86_400);
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    let hours = seconds_of_day / 3600;
    let minutes = (seconds_of_day % 3600) / 60;
    let hour12 = if hours % 12 == 0 { 12 } else { hours % 12 };
    let ampm = if hours < 12 { "AM" } else { "PM" };
    let month_name = MONTHS[usize::try_from(month - 1).ok()?];
    Some(format!(
        "{month_name} {day}, {year}, {hour12}:{minutes:02} {ampm}"
    ))
}

fn number(value: &Value) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str().and_then(|text| text.trim().parse().ok()))
}

#[allow(clippy::cast_possible_truncation)]
fn epoch(value: &Value) -> Option<i64> {
    number(value)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
        .map(|seconds| seconds as i64)
}

fn epoch_verdict(resets_at: i64, window: Option<&str>) -> UsageLimitVerdict {
    UsageLimitVerdict {
        reached: true,
        throttled: false,
        reset_time: format_epoch_reset_time_utc(resets_at),
        timezone: Some("UTC".to_string()),
        resets_at: Some(resets_at),
        window: window.map(ToString::to_string),
    }
}

/// Classify a Claude `rate_limit_event.rate_limit_info` (hive-mind#3570)
///
/// `status: "rejected"` with `resetsAt`, or a window at 100% without overage, is
/// a usage limit. `rejected` without `resetsAt` is a server throttle (#1924).
pub fn classify_rate_limit_event(info: &Value) -> UsageLimitVerdict {
    if !info.is_object() {
        return UsageLimitVerdict::default();
    }
    let resets_at = epoch(&info["resetsAt"]);
    let overage_status = info["overageStatus"].as_str();
    let overage_unavailable = info["isUsingOverage"] != true
        && (info.get("overageStatus").is_none_or(Value::is_null)
            || overage_status == Some("rejected")
            || info["overageEnabled"] == false);
    let exhausted =
        number(&info["utilization"]).is_some_and(|value| value >= 1.0) && overage_unavailable;
    let rejected = info["status"] == "rejected";
    match resets_at {
        Some(resets_at) if rejected || exhausted => {
            epoch_verdict(resets_at, info["rateLimitType"].as_str())
        }
        _ => UsageLimitVerdict {
            throttled: resets_at.is_none() && rejected,
            ..UsageLimitVerdict::default()
        },
    }
}

/// `ANTHROPIC_LOG=debug` output: which lines are debug dumps, and the 429 verdict
#[derive(Debug, Clone, Default)]
pub struct DebugLines {
    /// Indexes of lines that belong to debug output
    pub debug_lines: HashSet<usize>,
    /// Verdict from a 429 `anthropic-ratelimit-unified-*` header block
    pub verdict: UsageLimitVerdict,
}

struct DebugBlock {
    skip: bool,
    status: Option<u16>,
    headers: HashMap<String, String>,
}

/// Read `ANTHROPIC_LOG=debug` output lines (hive-mind#3570)
pub fn classify_debug_lines(lines: &[String]) -> DebugLines {
    let mut result = DebugLines::default();
    let mut block: Option<DebugBlock> = None;

    for (index, raw_line) in lines.iter().enumerate() {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if let Some(open) = block.as_mut() {
            result.debug_lines.insert(index);
            if BLOCK_END.is_match(line) {
                let resets_at = open
                    .headers
                    .get("anthropic-ratelimit-unified-reset")
                    .and_then(|value| epoch(&Value::String(value.clone())));
                if let Some(resets_at) = resets_at {
                    if open.status == Some(429)
                        && open
                            .headers
                            .get("anthropic-ratelimit-unified-status")
                            .is_some_and(|status| status == "rejected")
                    {
                        result.verdict = epoch_verdict(
                            resets_at,
                            open.headers
                                .get("anthropic-ratelimit-unified-representative-claim")
                                .map(String::as_str),
                        );
                    }
                }
                block = None;
            } else if !open.skip {
                if let Some(captures) = STATUS_LINE.captures(line) {
                    open.status = captures[1].parse().ok();
                }
                if let Some(captures) = HEADER_LINE.captures(line) {
                    if RATE_LIMIT_HEADER.is_match(&captures[1]) {
                        open.headers.insert(
                            captures[1].to_ascii_lowercase(),
                            captures[2].trim().to_string(),
                        );
                    }
                }
            }
            continue;
        }
        if DEBUG_BLOCK_START.is_match(line) {
            result.debug_lines.insert(index);
            if BLOCK_OPEN.is_match(line) {
                block = Some(DebugBlock {
                    skip: !DEBUG_RESPONSE_ERROR.is_match(line),
                    status: None,
                    headers: HashMap::new(),
                });
            }
        } else if BASE64_DUMP_LINE.is_match(line.trim()) {
            result.debug_lines.insert(index);
        }
    }

    result
}

/// A failed tool call is a tool result the model recovers from (hive-mind#3213)
pub fn is_recoverable_tool_error(event: &Value) -> bool {
    if !matches!(event["type"].as_str(), Some("error" | "step_error")) {
        return false;
    }
    event["recoverable"] == true
        || (event.pointer("/part/type") == Some(&Value::from("tool"))
            && event.pointer("/part/state/status") == Some(&Value::from("error")))
}

fn is_truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(flag) => *flag,
        Value::Number(number) => number.as_f64().is_some_and(|n| n != 0.0),
        Value::String(text) => !text.is_empty(),
        _ => true,
    }
}

/// Events whose text is tool or sub-agent output: a repository that mentions
/// "limit reached" must not mark the run as limited.
fn is_tool_output_event(event: &Value) -> bool {
    if !event.is_object() {
        return false;
    }
    let kind = event["type"].as_str().unwrap_or("");
    is_truthy(&event["parent_tool_use_id"])
        || matches!(kind, "user" | "tool_use" | "tool_result")
        || (kind.starts_with("item.") && event.pointer("/item/type") != Some(&Value::from("error")))
        || is_recoverable_tool_error(event)
}

fn collect_strings(value: &Value, out: &mut Vec<String>) {
    match value {
        Value::String(text) => out.push(text.clone()),
        Value::Array(values) => values.iter().for_each(|entry| collect_strings(entry, out)),
        Value::Object(map) => {
            if matches!(
                map.get("type").and_then(Value::as_str),
                Some("tool_use" | "tool_result")
            ) {
                return;
            }
            for (key, entry) in map {
                if key != "tool_use_result" {
                    collect_strings(entry, out);
                }
            }
        }
        _ => {}
    }
}

/// Split raw output into JSON records and the remaining text lines
pub fn split_output(output: &str) -> (Vec<Value>, Vec<String>) {
    let mut scanner = JsonRecordScanner::new();
    let mut events = scanner.write(output);
    events.extend(scanner.flush());
    let mut records = Vec::new();
    let mut lines = Vec::new();
    for event in events {
        match event {
            JsonRecordEvent::Json { value, .. } => records.push(value),
            JsonRecordEvent::Text(line) => lines.push(line),
            JsonRecordEvent::Invalid(_) => {}
        }
    }
    (records, lines)
}

fn scan_text(
    plain_output: &str,
    records: &[Value],
    lines: &[String],
    debug_lines: &HashSet<usize>,
    messages: &[Value],
) -> String {
    let mut strings = lines
        .iter()
        .enumerate()
        .filter(|(index, _)| !debug_lines.contains(index))
        .map(|(_, line)| line.clone())
        .collect::<Vec<_>>();
    let events = if plain_output.trim().is_empty() {
        messages
    } else {
        records
    };
    for record in events {
        let entries = match record {
            Value::Array(values) => values.iter().collect::<Vec<_>>(),
            value => vec![value],
        };
        for entry in entries {
            if !is_tool_output_event(entry) {
                collect_strings(entry, &mut strings);
            }
        }
    }
    strings.join("\n")
}

/// Text to scan for usage limits: plain lines stay raw, JSON records become
/// their string values (one per line), and tool output is left out.
pub fn limit_scan_text(plain_output: &str, messages: &[Value]) -> String {
    let (records, lines) = split_output(plain_output);
    let debug = classify_debug_lines(&lines);
    scan_text(plain_output, &records, &lines, &debug.debug_lines, messages)
}

/// Detect a usage limit from every source a run leaves behind
pub fn detect_usage_limit_sources(plain_output: &str, messages: &[Value]) -> UsageLimitVerdict {
    let (records, lines) = split_output(plain_output);
    let debug = classify_debug_lines(&lines);
    let text = scan_text(plain_output, &records, &lines, &debug.debug_lines, messages);
    let rate_limit_event = messages
        .iter()
        .rev()
        .find(|event| event["type"] == "rate_limit_event")
        .map(|event| classify_rate_limit_event(&event["rate_limit_info"]))
        .unwrap_or_default();
    let result = messages
        .iter()
        .rev()
        .find(|event| event["type"] == "result");
    let api_usage_limit = result.is_some_and(|event| event["api_error"] == "usage_limit_reached");
    let structured = [&rate_limit_event, &debug.verdict]
        .into_iter()
        .find(|verdict| verdict.reached);

    if !is_usage_limit_text(&text) && !api_usage_limit && structured.is_none() {
        return UsageLimitVerdict {
            throttled: rate_limit_event.throttled
                || THROTTLE.is_match(&text)
                || result.is_some_and(|event| event["api_error_status"] == 429),
            ..UsageLimitVerdict::default()
        };
    }

    // An epoch is exact; "resets 11am" lacks the date of a weekly window.
    if let Some(structured) = structured {
        return structured.clone();
    }
    let reset_time = extract_reset_time(&text);
    let timezone = reset_time
        .as_ref()
        .and_then(|_| extract_timezone(&text, raw_reset_time(&text).as_deref()));
    UsageLimitVerdict {
        reached: true,
        reset_time,
        timezone,
        ..UsageLimitVerdict::default()
    }
}
