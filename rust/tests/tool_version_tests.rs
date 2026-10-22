//! Tests for the tool version probe (issue #57).

use agent_commander::{
    build_version_command, compare_versions, get_tool_version, parse_tool_version,
    tool_version_from_output, ToolVersion,
};
use std::cmp::Ordering;

fn fixture(tool: &str) -> String {
    std::fs::read_to_string(format!(
        "{}/../docs/case-studies/issue-57/data/cli-help/{tool}.version",
        env!("CARGO_MANIFEST_DIR")
    ))
    .unwrap()
}

#[test]
fn parses_the_real_version_output_of_every_tool() {
    let expected = [
        ("agent", "0.26.15"),
        ("claude", "2.1.308"),
        ("codex", "0.163.0"),
        ("gemini", "0.64.0"),
        ("opencode", "1.19.3"),
        ("qwen", "0.25.2"),
    ];
    for (tool, version) in expected {
        assert_eq!(
            parse_tool_version(&fixture(tool)).as_deref(),
            Some(version),
            "{tool}"
        );
    }
    assert_eq!(
        parse_tool_version("v1.2.3-beta.1\n").as_deref(),
        Some("1.2.3-beta.1")
    );
    assert_eq!(parse_tool_version("command not found"), None);
}

#[test]
fn compares_numerically_with_prereleases_first() {
    assert_eq!(compare_versions("2.1.308", "2.1.99"), Ok(Ordering::Greater));
    assert_eq!(compare_versions("0.163.0", "0.163.0"), Ok(Ordering::Equal));
    assert_eq!(compare_versions("1.2", "1.2.0"), Ok(Ordering::Equal));
    assert_eq!(compare_versions("v1.0.0", "1.0.1"), Ok(Ordering::Less));
    assert_eq!(compare_versions("1.0.0-rc.1", "1.0.0"), Ok(Ordering::Less));
    assert_eq!(
        compare_versions("1.0.0-beta", "1.0.0-alpha"),
        Ok(Ordering::Greater)
    );
    assert!(compare_versions("latest", "1.0.0")
        .unwrap_err()
        .contains("Invalid version"));
}

#[test]
fn builds_the_probe_command() {
    assert_eq!(
        build_version_command("claude", None).unwrap(),
        "claude --version 2>&1"
    );
    assert_eq!(
        build_version_command("codex", Some("/opt/my codex")).unwrap(),
        "\"/opt/my codex\" --version 2>&1"
    );
    assert!(build_version_command("nope", None)
        .unwrap_err()
        .contains("Unknown tool"));
}

#[test]
fn separates_missing_broken_and_outdated_tools() {
    assert_eq!(
        tool_version_from_output("codex", 0, "codex-cli 0.163.0\n", Some("0.160.0")),
        ToolVersion {
            tool: "codex".to_string(),
            installed: true,
            version: Some("0.163.0".to_string()),
            raw: "codex-cli 0.163.0".to_string(),
            meets_minimum: Some(true),
        }
    );
    let missing = tool_version_from_output("qwen", 127, "qwen: command not found", Some("0.1.0"));
    assert!(!missing.installed);
    assert_eq!(missing.version, None);
    assert_eq!(missing.meets_minimum, Some(false));
    let broken = tool_version_from_output("gemini", 1, "", None);
    assert!(broken.installed);
    assert_eq!(broken.meets_minimum, None);
    assert_eq!(
        tool_version_from_output("claude", 0, "2.0.1 (Claude Code)", Some("2.1.0")).meets_minimum,
        Some(false)
    );
}

#[tokio::test]
async fn reports_a_missing_executable() {
    let result = get_tool_version("codex", Some("/nonexistent/agent-commander-codex"), None)
        .await
        .unwrap();
    assert!(!result.installed);
    assert_eq!(result.version, None);
}

#[tokio::test]
async fn probes_a_real_executable() {
    // `bash --version` stands in for a CLI: the probe only needs `--version`.
    let result = get_tool_version("claude", Some("bash"), Some("1.0.0"))
        .await
        .unwrap();
    assert!(result.installed);
    assert!(result.version.is_some(), "{}", result.raw);
    assert_eq!(result.meets_minimum, Some(true));
}
