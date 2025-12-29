//! Tool configurations and utilities
//! Provides configuration for different CLI agents: claude, codex, opencode, agent

pub mod claude;
pub mod codex;
pub mod opencode;
pub mod agent;

use std::collections::HashMap;

pub use claude::{ClaudeTool, ClaudeBuildOptions, ClaudeUsage};
pub use codex::{CodexTool, CodexBuildOptions, CodexUsage};
pub use opencode::{OpencodeTool, OpencodeBuildOptions, OpencodeUsage};
pub use agent::{AgentTool, AgentBuildOptions, AgentUsage, ErrorResult};

/// Generic tool trait
pub trait Tool {
    fn name(&self) -> &'static str;
    fn display_name(&self) -> &'static str;
    fn executable(&self) -> &'static str;
    fn supports_json_output(&self) -> bool;
    fn supports_json_input(&self) -> bool;
    fn supports_system_prompt(&self) -> bool;
    fn supports_resume(&self) -> bool;
    fn default_model(&self) -> &'static str;
}

impl Tool for ClaudeTool {
    fn name(&self) -> &'static str { self.name }
    fn display_name(&self) -> &'static str { self.display_name }
    fn executable(&self) -> &'static str { self.executable }
    fn supports_json_output(&self) -> bool { self.supports_json_output }
    fn supports_json_input(&self) -> bool { self.supports_json_input }
    fn supports_system_prompt(&self) -> bool { self.supports_system_prompt }
    fn supports_resume(&self) -> bool { self.supports_resume }
    fn default_model(&self) -> &'static str { self.default_model }
}

impl Tool for CodexTool {
    fn name(&self) -> &'static str { self.name }
    fn display_name(&self) -> &'static str { self.display_name }
    fn executable(&self) -> &'static str { self.executable }
    fn supports_json_output(&self) -> bool { self.supports_json_output }
    fn supports_json_input(&self) -> bool { self.supports_json_input }
    fn supports_system_prompt(&self) -> bool { self.supports_system_prompt }
    fn supports_resume(&self) -> bool { self.supports_resume }
    fn default_model(&self) -> &'static str { self.default_model }
}

impl Tool for OpencodeTool {
    fn name(&self) -> &'static str { self.name }
    fn display_name(&self) -> &'static str { self.display_name }
    fn executable(&self) -> &'static str { self.executable }
    fn supports_json_output(&self) -> bool { self.supports_json_output }
    fn supports_json_input(&self) -> bool { self.supports_json_input }
    fn supports_system_prompt(&self) -> bool { self.supports_system_prompt }
    fn supports_resume(&self) -> bool { self.supports_resume }
    fn default_model(&self) -> &'static str { self.default_model }
}

impl Tool for AgentTool {
    fn name(&self) -> &'static str { self.name }
    fn display_name(&self) -> &'static str { self.display_name }
    fn executable(&self) -> &'static str { self.executable }
    fn supports_json_output(&self) -> bool { self.supports_json_output }
    fn supports_json_input(&self) -> bool { self.supports_json_input }
    fn supports_system_prompt(&self) -> bool { self.supports_system_prompt }
    fn supports_resume(&self) -> bool { self.supports_resume }
    fn default_model(&self) -> &'static str { self.default_model }
}

/// Tool registry for all supported tools
pub struct ToolRegistry {
    tools: HashMap<&'static str, Box<dyn Tool + Send + Sync>>,
}

impl Default for ToolRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl ToolRegistry {
    /// Create a new tool registry with all supported tools
    pub fn new() -> Self {
        let mut tools: HashMap<&'static str, Box<dyn Tool + Send + Sync>> = HashMap::new();
        tools.insert("claude", Box::new(ClaudeTool::default()));
        tools.insert("codex", Box::new(CodexTool::default()));
        tools.insert("opencode", Box::new(OpencodeTool::default()));
        tools.insert("agent", Box::new(AgentTool::default()));
        Self { tools }
    }

    /// Get tool by name
    pub fn get(&self, name: &str) -> Option<&(dyn Tool + Send + Sync)> {
        self.tools.get(name).map(|t| t.as_ref())
    }

    /// Check if a tool is supported
    pub fn is_supported(&self, name: &str) -> bool {
        self.tools.contains_key(name)
    }

    /// List all available tool names
    pub fn list(&self) -> Vec<&'static str> {
        self.tools.keys().copied().collect()
    }
}

/// Get tool configuration by name
///
/// # Arguments
/// * `tool_name` - Name of the tool
///
/// # Returns
/// Result with tool reference or error
pub fn get_tool(tool_name: &str) -> Result<Box<dyn Tool + Send + Sync>, String> {
    match tool_name {
        "claude" => Ok(Box::new(ClaudeTool::default())),
        "codex" => Ok(Box::new(CodexTool::default())),
        "opencode" => Ok(Box::new(OpencodeTool::default())),
        "agent" => Ok(Box::new(AgentTool::default())),
        _ => Err(format!(
            "Unknown tool: {}. Available tools: claude, codex, opencode, agent",
            tool_name
        )),
    }
}

/// List available tools
pub fn list_tools() -> Vec<&'static str> {
    vec!["claude", "codex", "opencode", "agent"]
}

/// Check if a tool is supported
///
/// # Arguments
/// * `tool_name` - Name of the tool
///
/// # Returns
/// True if tool is supported
pub fn is_tool_supported(tool_name: &str) -> bool {
    ["claude", "codex", "opencode", "agent"].contains(&tool_name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_list_tools() {
        let tools = list_tools();
        assert!(tools.contains(&"claude"));
        assert!(tools.contains(&"codex"));
        assert!(tools.contains(&"opencode"));
        assert!(tools.contains(&"agent"));
    }

    #[test]
    fn test_is_tool_supported() {
        assert!(is_tool_supported("claude"));
        assert!(is_tool_supported("codex"));
        assert!(is_tool_supported("opencode"));
        assert!(is_tool_supported("agent"));
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
        assert!(!registry.is_supported("unknown"));

        let claude = registry.get("claude").unwrap();
        assert_eq!(claude.name(), "claude");
    }
}
