//! Per-run tool overrides (issue #57).
//!
//! A caller replaces a failing or missing part of a tool for one run — the
//! command builder, the output parser, the session ID or usage extractor, or
//! the launch capabilities — without waiting for an agent-commander release.
//! With a `build_command` an override also drives a tool that is not
//! registered. Unset fields keep the built-in behavior.

use crate::command_builder::AgentCommandOptions;
use crate::tools::launch_options::LaunchCapabilities;
use serde_json::Value;
use std::fmt;
use std::panic::RefUnwindSafe;
use std::sync::Arc;

/// Builds the native tool command (without the `cd` and isolation wrappers)
pub type BuildCommandFn = Arc<dyn Fn(&AgentCommandOptions) -> String + Send + Sync + RefUnwindSafe>;
/// Parses the tool's stdout into messages
pub type ParseOutputFn = Arc<dyn Fn(&str) -> Vec<Value> + Send + Sync + RefUnwindSafe>;
/// Reads the session ID from the tool's stdout
pub type ExtractSessionIdFn = Arc<dyn Fn(&str) -> Option<String> + Send + Sync + RefUnwindSafe>;
/// Reads the token usage from the tool's stdout
pub type ExtractUsageFn = Arc<dyn Fn(&str) -> Option<Value> + Send + Sync + RefUnwindSafe>;

/// Replacements for parts of a tool; `None` keeps the built-in part
#[derive(Clone, Default)]
pub struct ToolOverrides {
    /// Replaces the tool-specific command builder; it can call
    /// [`crate::command_builder::build_base_command`] and extend the result
    pub build_command: Option<BuildCommandFn>,
    /// Replaces the output parser, including the streamed messages
    pub parse_output: Option<ParseOutputFn>,
    /// Replaces the session ID extractor
    pub extract_session_id: Option<ExtractSessionIdFn>,
    /// Replaces the usage extractor
    pub extract_usage: Option<ExtractUsageFn>,
    /// Replaces the launch capabilities checked before the run, so a builder
    /// that adds a native flag can accept the matching launch option
    pub launch_capabilities: Option<LaunchCapabilities>,
}

impl ToolOverrides {
    /// Whether no part is replaced
    pub fn is_empty(&self) -> bool {
        self.build_command.is_none()
            && self.parse_output.is_none()
            && self.extract_session_id.is_none()
            && self.extract_usage.is_none()
            && self.launch_capabilities.is_none()
    }
}

impl fmt::Debug for ToolOverrides {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("ToolOverrides")
            .field("build_command", &self.build_command.is_some())
            .field("parse_output", &self.parse_output.is_some())
            .field("extract_session_id", &self.extract_session_id.is_some())
            .field("extract_usage", &self.extract_usage.is_some())
            .field("launch_capabilities", &self.launch_capabilities)
            .finish()
    }
}
