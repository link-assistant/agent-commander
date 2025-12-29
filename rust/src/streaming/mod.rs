//! JSON Streaming utilities
//! Support for NDJSON (Newline Delimited JSON) input and output

pub mod ndjson;
pub mod input_stream;
pub mod output_stream;

pub use ndjson::{parse_ndjson_line, stringify_ndjson_line, parse_ndjson, stringify_ndjson};
pub use input_stream::JsonInputStream;
pub use output_stream::{JsonOutputStream, ParseError};

/// Create a JSON output stream processor
pub fn create_output_stream() -> JsonOutputStream {
    JsonOutputStream::new()
}

/// Create a JSON input stream for sending messages
///
/// # Arguments
/// * `compact` - Use compact JSON (no newlines within messages)
pub fn create_input_stream(compact: bool) -> JsonInputStream {
    JsonInputStream::new(compact)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_create_output_stream() {
        let stream = create_output_stream();
        assert_eq!(stream.get_messages().len(), 0);
    }

    #[test]
    fn test_create_input_stream() {
        let stream = create_input_stream(true);
        assert_eq!(stream.size(), 0);
    }
}
