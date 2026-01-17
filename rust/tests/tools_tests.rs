//! Tests for tool registry and configuration

use agent_commander::tools::{get_tool, is_tool_supported, list_tools, ToolRegistry};

#[test]
fn test_list_tools() {
    let tools = list_tools();
    assert!(tools.contains(&"claude"));
    assert!(tools.contains(&"codex"));
    assert!(tools.contains(&"opencode"));
    assert!(tools.contains(&"agent"));
    assert!(tools.contains(&"gemini"));
}

#[test]
fn test_is_tool_supported() {
    assert!(is_tool_supported("claude"));
    assert!(is_tool_supported("codex"));
    assert!(is_tool_supported("opencode"));
    assert!(is_tool_supported("agent"));
    assert!(is_tool_supported("gemini"));
    assert!(!is_tool_supported("unknown"));
    assert!(!is_tool_supported(""));
}

#[test]
fn test_get_tool() {
    let claude = get_tool("claude").unwrap();
    assert_eq!(claude.name(), "claude");
    assert_eq!(claude.executable(), "claude");
    assert!(claude.supports_json_output());
}

#[test]
fn test_get_tool_unknown() {
    let result = get_tool("unknown");
    assert!(result.is_err());
    if let Err(e) = result {
        assert!(e.contains("Unknown tool: unknown"));
    }
}

#[test]
fn test_tool_registry() {
    let registry = ToolRegistry::new();
    assert!(registry.is_supported("claude"));
    assert!(registry.is_supported("gemini"));
    assert!(!registry.is_supported("unknown"));

    let claude = registry.get("claude").unwrap();
    assert_eq!(claude.name(), "claude");

    let gemini = registry.get("gemini").unwrap();
    assert_eq!(gemini.name(), "gemini");
}

#[test]
fn test_get_tool_gemini() {
    let gemini = get_tool("gemini").unwrap();
    assert_eq!(gemini.name(), "gemini");
    assert_eq!(gemini.executable(), "gemini");
    assert!(gemini.supports_json_output());
    assert!(!gemini.supports_json_input());
}

#[test]
fn test_get_tool_codex() {
    let codex = get_tool("codex").unwrap();
    assert_eq!(codex.name(), "codex");
    assert_eq!(codex.executable(), "codex");
    assert!(codex.supports_json_output());
    assert!(codex.supports_resume());
}

#[test]
fn test_get_tool_opencode() {
    let opencode = get_tool("opencode").unwrap();
    assert_eq!(opencode.name(), "opencode");
    assert_eq!(opencode.executable(), "opencode");
    assert!(opencode.supports_json_output());
    assert!(opencode.supports_resume());
}

#[test]
fn test_get_tool_agent() {
    let agent = get_tool("agent").unwrap();
    assert_eq!(agent.name(), "agent");
    assert_eq!(agent.executable(), "agent");
    assert!(agent.supports_json_output());
    assert!(agent.supports_json_input());
}

#[test]
fn test_tool_registry_list() {
    let registry = ToolRegistry::new();
    let tools = registry.list();
    assert!(tools.contains(&"claude"));
    assert!(tools.contains(&"codex"));
    assert!(tools.contains(&"opencode"));
    assert!(tools.contains(&"agent"));
    assert!(tools.contains(&"gemini"));
}

#[test]
fn test_tool_display_names() {
    let claude = get_tool("claude").unwrap();
    assert_eq!(claude.display_name(), "Claude Code CLI");

    let gemini = get_tool("gemini").unwrap();
    assert_eq!(gemini.display_name(), "Gemini CLI");
}

#[test]
fn test_tool_default_models() {
    let claude = get_tool("claude").unwrap();
    assert_eq!(claude.default_model(), "sonnet");

    let gemini = get_tool("gemini").unwrap();
    assert_eq!(gemini.default_model(), "gemini-2.5-flash");
}
