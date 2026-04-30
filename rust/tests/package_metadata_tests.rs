//! Tests for crate package metadata.

use std::{fs, path::Path};

#[test]
fn rust_crate_declares_and_ships_readme() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let cargo_toml = fs::read_to_string(root.join("Cargo.toml")).expect("read Cargo.toml");
    let readme = fs::read_to_string(root.join("README.md")).expect("read README.md");

    assert!(root.join("Cargo.lock").is_file());
    assert!(cargo_toml.contains("readme = \"README.md\""));
    assert!(readme.contains("# agent-commander"));
    assert!(readme.contains("cargo add agent-commander"));
    assert!(readme.contains("start-agent --tool claude"));
}
