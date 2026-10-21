//! Bounded reads of append-only session files (Codex rollouts, Claude
//! transcripts).

use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

/// Read at most `max_bytes` from the end of a file.
///
/// When the file is longer, the cut first line is dropped, because it is not
/// a whole record.
pub fn read_file_tail(path: &Path, max_bytes: u64) -> std::io::Result<String> {
    let mut file = fs::File::open(path)?;
    let size = file.metadata()?.len();
    let length = size.min(max_bytes);
    file.seek(SeekFrom::Start(size - length))?;
    let mut buffer = Vec::new();
    file.take(length).read_to_end(&mut buffer)?;
    let text = String::from_utf8_lossy(&buffer).into_owned();
    if length < size {
        if let Some(index) = text.find('\n') {
            return Ok(text[index + 1..].to_string());
        }
    }
    Ok(text)
}

/// Home directory: `HOME`, then `USERPROFILE` (Windows)
pub fn default_home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .unwrap_or_default()
}
