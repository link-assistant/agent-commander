//! JSON Streaming utilities
//! Support for NDJSON (Newline Delimited JSON) input and output

pub mod input_stream;
pub mod ndjson;
pub mod output_stream;

pub use input_stream::JsonInputStream;
pub use ndjson::{parse_ndjson, parse_ndjson_line, stringify_ndjson, stringify_ndjson_line};
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

// Tests are in rust/tests/streaming_tests.rs
