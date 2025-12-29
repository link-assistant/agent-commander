//! JSON Output Stream processor
//! Processes NDJSON output from CLI tools

use serde_json::Value;
use super::ndjson::parse_ndjson_line;

/// Error information for failed JSON parses
#[derive(Debug, Clone)]
pub struct ParseError {
    pub line: String,
    pub line_number: usize,
}

/// JSON Output Stream class
/// Processes streaming output and emits parsed JSON messages
pub struct JsonOutputStream {
    buffer: String,
    messages: Vec<Value>,
    errors: Vec<ParseError>,
    line_count: usize,
    on_message: Option<Box<dyn Fn(&Value, usize)>>,
    on_error: Option<Box<dyn Fn(&ParseError)>>,
    on_raw_line: Option<Box<dyn Fn(&str, usize)>>,
}

impl std::fmt::Debug for JsonOutputStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("JsonOutputStream")
            .field("buffer", &self.buffer)
            .field("messages", &self.messages)
            .field("errors", &self.errors)
            .field("line_count", &self.line_count)
            .finish()
    }
}

impl Default for JsonOutputStream {
    fn default() -> Self {
        Self::new()
    }
}

impl JsonOutputStream {
    /// Create a new JSON output stream processor
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            messages: Vec::new(),
            errors: Vec::new(),
            line_count: 0,
            on_message: None,
            on_error: None,
            on_raw_line: None,
        }
    }

    /// Set callback for each parsed message
    pub fn set_on_message<F>(&mut self, callback: F)
    where
        F: Fn(&Value, usize) + 'static,
    {
        self.on_message = Some(Box::new(callback));
    }

    /// Set callback for parse errors
    pub fn set_on_error<F>(&mut self, callback: F)
    where
        F: Fn(&ParseError) + 'static,
    {
        self.on_error = Some(Box::new(callback));
    }

    /// Set callback for each raw line
    pub fn set_on_raw_line<F>(&mut self, callback: F)
    where
        F: Fn(&str, usize) + 'static,
    {
        self.on_raw_line = Some(Box::new(callback));
    }

    /// Process a chunk of output data
    ///
    /// # Arguments
    /// * `chunk` - Data chunk to process
    ///
    /// # Returns
    /// Vector of messages parsed from this chunk
    pub fn process(&mut self, chunk: &str) -> Vec<Value> {
        self.buffer.push_str(chunk);

        // Split and collect into owned strings to avoid borrow issues
        let lines: Vec<String> = self.buffer.split('\n').map(|s| s.to_string()).collect();
        let (complete_lines, last) = lines.split_at(lines.len().saturating_sub(1));

        // Keep the last incomplete line in the buffer
        self.buffer = last.first().cloned().unwrap_or_default();

        let mut new_messages = Vec::new();

        for line in complete_lines {
            self.line_count += 1;

            if let Some(ref callback) = self.on_raw_line {
                callback(line, self.line_count);
            }

            if let Some(parsed) = parse_ndjson_line(line) {
                self.messages.push(parsed.clone());
                new_messages.push(parsed.clone());

                if let Some(ref callback) = self.on_message {
                    callback(&parsed, self.line_count);
                }
            } else if line.trim().starts_with('{') {
                // Line looked like JSON but failed to parse
                let error = ParseError {
                    line: line.to_string(),
                    line_number: self.line_count,
                };
                self.errors.push(error.clone());

                if let Some(ref callback) = self.on_error {
                    callback(&error);
                }
            }
        }

        new_messages
    }

    /// Flush any remaining data in the buffer
    ///
    /// # Returns
    /// Vector of messages from flushed buffer
    pub fn flush(&mut self) -> Vec<Value> {
        if self.buffer.trim().is_empty() {
            return Vec::new();
        }

        let line = std::mem::take(&mut self.buffer);
        self.line_count += 1;

        if let Some(ref callback) = self.on_raw_line {
            callback(&line, self.line_count);
        }

        if let Some(parsed) = parse_ndjson_line(&line) {
            self.messages.push(parsed.clone());

            if let Some(ref callback) = self.on_message {
                callback(&parsed, self.line_count);
            }

            return vec![parsed];
        } else if line.trim().starts_with('{') {
            let error = ParseError {
                line,
                line_number: self.line_count,
            };
            self.errors.push(error.clone());

            if let Some(ref callback) = self.on_error {
                callback(&error);
            }
        }

        Vec::new()
    }

    /// Get all collected messages
    pub fn get_messages(&self) -> &[Value] {
        &self.messages
    }

    /// Get all parse errors
    pub fn get_errors(&self) -> &[ParseError] {
        &self.errors
    }

    /// Reset the stream processor
    pub fn reset(&mut self) {
        self.buffer.clear();
        self.messages.clear();
        self.errors.clear();
        self.line_count = 0;
    }

    /// Filter messages by type
    ///
    /// # Arguments
    /// * `msg_type` - Message type to filter
    pub fn filter_by_type(&self, msg_type: &str) -> Vec<&Value> {
        self.messages.iter()
            .filter(|msg| msg.get("type").and_then(|t| t.as_str()) == Some(msg_type))
            .collect()
    }

    /// Find first message matching a predicate
    ///
    /// # Arguments
    /// * `predicate` - Filter function
    pub fn find<F>(&self, predicate: F) -> Option<&Value>
    where
        F: Fn(&Value) -> bool,
    {
        self.messages.iter().find(|msg| predicate(msg))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_process_single_json_line() {
        let mut stream = JsonOutputStream::new();
        let messages = stream.process("{\"type\":\"hello\"}\n");

        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0], json!({"type": "hello"}));
    }

    #[test]
    fn test_process_multiple_json_lines() {
        let mut stream = JsonOutputStream::new();
        let messages = stream.process("{\"a\":1}\n{\"b\":2}\n");

        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0], json!({"a": 1}));
        assert_eq!(messages[1], json!({"b": 2}));
    }

    #[test]
    fn test_handles_partial_lines_across_chunks() {
        let mut stream = JsonOutputStream::new();

        // First chunk: partial line
        let messages1 = stream.process("{\"type\":\"mes");
        assert_eq!(messages1.len(), 0);

        // Second chunk: completes line
        let messages2 = stream.process("sage\"}\n");
        assert_eq!(messages2.len(), 1);
        assert_eq!(messages2[0], json!({"type": "message"}));
    }

    #[test]
    fn test_get_messages_returns_all() {
        let mut stream = JsonOutputStream::new();
        stream.process("{\"a\":1}\n");
        stream.process("{\"b\":2}\n");

        let messages = stream.get_messages();
        assert_eq!(messages.len(), 2);
    }

    #[test]
    fn test_flush_processes_remaining_buffer() {
        let mut stream = JsonOutputStream::new();
        stream.process("{\"type\":\"final\"}"); // No trailing newline

        // Buffer should have content
        assert_eq!(stream.get_messages().len(), 0);

        // Flush should process remaining
        let flushed = stream.flush();
        assert_eq!(flushed.len(), 1);
        assert_eq!(flushed[0], json!({"type": "final"}));
    }

    #[test]
    fn test_filter_by_type() {
        let mut stream = JsonOutputStream::new();
        stream.process("{\"type\":\"a\"}\n{\"type\":\"b\"}\n{\"type\":\"a\"}\n");

        let filtered = stream.filter_by_type("a");
        assert_eq!(filtered.len(), 2);
    }

    #[test]
    fn test_reset_clears_state() {
        let mut stream = JsonOutputStream::new();
        stream.process("{\"a\":1}\n");
        stream.reset();

        assert_eq!(stream.get_messages().len(), 0);
    }
}
