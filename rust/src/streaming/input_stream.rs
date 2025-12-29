//! JSON Input Stream
//! Creates NDJSON input for CLI tools

use serde_json::{json, Value};
use super::ndjson::stringify_ndjson_line;

/// JSON Input Stream struct
/// Builds NDJSON input for streaming to CLI tools
#[derive(Debug, Clone)]
pub struct JsonInputStream {
    compact: bool,
    messages: Vec<Value>,
}

impl Default for JsonInputStream {
    fn default() -> Self {
        Self::new(true)
    }
}

impl JsonInputStream {
    /// Create a new JSON input stream
    ///
    /// # Arguments
    /// * `compact` - Use compact JSON (default: true)
    pub fn new(compact: bool) -> Self {
        Self {
            compact,
            messages: Vec::new(),
        }
    }

    /// Add a message to the stream
    ///
    /// # Arguments
    /// * `message` - Message to add
    ///
    /// # Returns
    /// Self for chaining
    pub fn add(&mut self, message: Value) -> &mut Self {
        if !message.is_null() {
            self.messages.push(message);
        }
        self
    }

    /// Add a user prompt message
    ///
    /// # Arguments
    /// * `content` - Prompt content
    ///
    /// # Returns
    /// Self for chaining
    pub fn add_prompt(&mut self, content: &str) -> &mut Self {
        self.add(json!({
            "type": "user_prompt",
            "content": content
        }))
    }

    /// Add a system message
    ///
    /// # Arguments
    /// * `content` - System message content
    ///
    /// # Returns
    /// Self for chaining
    pub fn add_system_message(&mut self, content: &str) -> &mut Self {
        self.add(json!({
            "type": "system",
            "content": content
        }))
    }

    /// Add a configuration message
    ///
    /// # Arguments
    /// * `config` - Configuration object
    ///
    /// # Returns
    /// Self for chaining
    pub fn add_config(&mut self, config: Value) -> &mut Self {
        let mut msg = json!({"type": "config"});
        if let (Some(obj), Some(cfg)) = (msg.as_object_mut(), config.as_object()) {
            for (k, v) in cfg {
                obj.insert(k.clone(), v.clone());
            }
        }
        self.add(msg)
    }

    /// Convert the stream to NDJSON string
    pub fn to_string(&self) -> String {
        self.messages.iter()
            .map(|msg| stringify_ndjson_line(msg, self.compact))
            .collect()
    }

    /// Convert the stream to bytes
    pub fn to_bytes(&self) -> Vec<u8> {
        self.to_string().into_bytes()
    }

    /// Get the number of messages in the stream
    pub fn size(&self) -> usize {
        self.messages.len()
    }

    /// Clear all messages
    pub fn clear(&mut self) -> &mut Self {
        self.messages.clear();
        self
    }

    /// Get all messages
    pub fn get_messages(&self) -> &[Value] {
        &self.messages
    }

    /// Create from a vector of messages
    ///
    /// # Arguments
    /// * `messages` - Vector of messages
    /// * `compact` - Use compact JSON
    pub fn from_messages(messages: Vec<Value>, compact: bool) -> Self {
        Self { compact, messages }
    }
}

impl std::fmt::Display for JsonInputStream {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_add_message() {
        let mut stream = JsonInputStream::new(true);
        stream.add(json!({"type": "hello"}));
        assert_eq!(stream.size(), 1);
    }

    #[test]
    fn test_to_string_produces_ndjson() {
        let mut stream = JsonInputStream::new(true);
        stream.add(json!({"a": 1}));
        stream.add(json!({"b": 2}));

        let output = stream.to_string();
        assert_eq!(output, "{\"a\":1}\n{\"b\":2}\n");
    }

    #[test]
    fn test_add_prompt() {
        let mut stream = JsonInputStream::new(true);
        stream.add_prompt("Hello");

        let messages = stream.get_messages();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["type"], "user_prompt");
        assert_eq!(messages[0]["content"], "Hello");
    }

    #[test]
    fn test_add_system_message() {
        let mut stream = JsonInputStream::new(true);
        stream.add_system_message("You are helpful");

        let messages = stream.get_messages();
        assert_eq!(messages[0]["type"], "system");
    }

    #[test]
    fn test_chaining() {
        let mut stream = JsonInputStream::new(true);
        stream
            .add_system_message("System")
            .add_prompt("User")
            .add(json!({"custom": true}));

        assert_eq!(stream.size(), 3);
    }

    #[test]
    fn test_clear() {
        let mut stream = JsonInputStream::new(true);
        stream.add(json!({"a": 1}));
        stream.clear();
        assert_eq!(stream.size(), 0);
    }

    #[test]
    fn test_from_messages() {
        let messages = vec![json!({"a": 1}), json!({"b": 2})];
        let stream = JsonInputStream::from_messages(messages, true);
        assert_eq!(stream.size(), 2);
    }

    #[test]
    fn test_to_bytes() {
        let mut stream = JsonInputStream::new(true);
        stream.add(json!({"test": true}));

        let bytes = stream.to_bytes();
        let str_result = String::from_utf8(bytes).unwrap();
        assert_eq!(str_result, "{\"test\":true}\n");
    }
}
