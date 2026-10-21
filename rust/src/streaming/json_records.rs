//! Balanced JSON record scanner for native CLI output
//!
//! Line-based NDJSON parsing drops every structured event when a tool prints
//! pretty-printed JSON (the `@link-assistant/agent` CLI does so unless
//! `--compact-json` is passed), concatenates records without a separator, or
//! splits one record across process chunks. Scanning for balanced JSON values
//! handles all three shapes, and NDJSON is the single-line special case.
//! Ported from Hive Mind `src/json-stream.lib.mjs` (hive-mind#2119, #1250).

use serde_json::Value;

/// An unbalanced fragment (prose starting with `{`) is released past this size.
pub const DEFAULT_MAX_PENDING_BYTES: usize = 4 * 1024 * 1024;

/// Event emitted by [`JsonRecordScanner`]
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum JsonRecordEvent {
    /// A complete JSON value and its raw text
    Json { value: Value, raw: String },
    /// A non-empty line that is not part of a JSON value
    Text(String),
    /// A balanced `{...}` fragment that is not valid JSON (followed by its text line)
    Invalid(String),
}

/// Stateful scanner that turns output text into JSON and text events
#[derive(Debug, Clone)]
pub struct JsonRecordScanner {
    pending: String,
    max_pending_bytes: usize,
}

impl Default for JsonRecordScanner {
    fn default() -> Self {
        Self::new()
    }
}

fn is_opener(byte: u8) -> bool {
    byte == b'{' || byte == b'['
}

/// Find the index just past the JSON value that starts at `start`
fn find_value_end(buffer: &[u8], start: usize) -> Option<usize> {
    let mut depth: i64 = 0;
    let mut in_string = false;
    let mut escaped = false;

    for (index, &byte) in buffer.iter().enumerate().skip(start) {
        if in_string {
            if escaped {
                escaped = false;
            } else if byte == b'\\' {
                escaped = true;
            } else if byte == b'"' {
                in_string = false;
            }
            continue;
        }
        match byte {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                depth -= 1;
                if depth == 0 {
                    return Some(index + 1);
                }
                if depth < 0 {
                    return None;
                }
            }
            _ => {}
        }
    }

    None
}

fn push_text(text: &str, events: &mut Vec<JsonRecordEvent>) {
    for line in text.split('\n') {
        let value = line.strip_suffix('\r').unwrap_or(line);
        if !value.trim().is_empty() {
            events.push(JsonRecordEvent::Text(value.to_string()));
        }
    }
}

impl JsonRecordScanner {
    /// Create a scanner with the default pending-buffer limit
    pub fn new() -> Self {
        Self::with_max_pending_bytes(DEFAULT_MAX_PENDING_BYTES)
    }

    /// Create a scanner that releases an unbalanced buffer past `max_pending_bytes`
    pub fn with_max_pending_bytes(max_pending_bytes: usize) -> Self {
        Self {
            pending: String::new(),
            max_pending_bytes,
        }
    }

    /// Feed a chunk and return the events it completes
    pub fn write(&mut self, chunk: &str) -> Vec<JsonRecordEvent> {
        self.pending.push_str(chunk);
        self.scan(false)
    }

    /// Return the events left in the buffer at end of output
    pub fn flush(&mut self) -> Vec<JsonRecordEvent> {
        let events = self.scan(true);
        self.pending.clear();
        events
    }

    /// Text buffered while waiting for the rest of a record or line
    pub fn pending(&self) -> &str {
        &self.pending
    }

    fn scan(&mut self, last: bool) -> Vec<JsonRecordEvent> {
        let mut events = Vec::new();
        let mut index = 0;
        let pending = std::mem::take(&mut self.pending);
        let bytes = pending.as_bytes();

        while index < bytes.len() {
            let byte = bytes[index];
            if byte.is_ascii_whitespace() {
                index += 1;
                continue;
            }

            if is_opener(byte) {
                match find_value_end(bytes, index) {
                    Some(end) => {
                        let raw = &pending[index..end];
                        if let Ok(value) = serde_json::from_str::<Value>(raw) {
                            events.push(JsonRecordEvent::Json {
                                value,
                                raw: raw.to_string(),
                            });
                            index = end;
                            continue;
                        }
                        // Bracketed prose such as "[INFO] ..." stays one text line.
                        if byte == b'{' && (last || pending[index..].contains('\n')) {
                            events.push(JsonRecordEvent::Invalid(raw.to_string()));
                        }
                    }
                    None if !last => break,
                    None => {}
                }
                // Not JSON, or the output ended inside this value: keep the line
                // as text and resume on the next line so later records are not lost.
            }

            let newline = pending[index..].find('\n').map(|offset| index + offset);
            if newline.is_none() && !last {
                break;
            }
            let line_end = newline.unwrap_or(bytes.len());
            push_text(&pending[index..line_end], &mut events);
            index = line_end + 1;
        }

        self.pending = pending[index.min(bytes.len())..].to_string();
        if self.pending.len() > self.max_pending_bytes {
            push_text(&std::mem::take(&mut self.pending), &mut events);
        }
        events
    }
}

/// Extract every complete JSON value from finished output, in stream order
pub fn parse_json_records(output: &str) -> Vec<Value> {
    let mut scanner = JsonRecordScanner::new();
    let mut events = scanner.write(output);
    events.extend(scanner.flush());
    events
        .into_iter()
        .filter_map(|event| match event {
            JsonRecordEvent::Json { value, .. } => Some(value),
            _ => None,
        })
        .collect()
}
