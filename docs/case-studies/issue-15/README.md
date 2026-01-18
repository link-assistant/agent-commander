# Case Study: JSON Output/Input Documentation Accuracy

**Issue:** [#15 - Double check for JSON Output and JSON Input for all our tools](https://github.com/link-assistant/agent-commander/issues/15)

This document captures the investigation and resolution of documentation discrepancies in the agent-commander README.md regarding JSON input/output support for supported CLI tools.

## Overview

The issue identified two documentation problems:
1. **Missing Gemini CLI** - Not listed in the Supported Tools table despite being fully implemented
2. **Incorrect Agent CLI JSON Input status** - Marked as ❌ but actually supports JSON input

## Investigation Methodology

### Data Collection

1. **Repository Analysis**: Examined the codebase for actual tool configurations
2. **External Verification**: Checked upstream repositories (@link-assistant/agent, google-gemini/gemini-cli)
3. **Code Review**: Analyzed `js/src/tools/*.mjs` configuration files
4. **Documentation Review**: Cross-referenced README.md claims with actual capabilities

### Evidence Sources

| Source | Location | Key Finding |
|--------|----------|-------------|
| agent.mjs | js/src/tools/agent.mjs:246 | `supportsJsonInput: true` |
| gemini.mjs | js/src/tools/gemini.mjs | Full Gemini CLI implementation |
| tools/index.mjs | js/src/tools/index.mjs:21 | Exports `geminiTool` |
| @link-assistant/agent | GitHub README | "JSON Input/Output: Accepts JSON via stdin" |
| google-gemini/gemini-cli | GitHub README | Supports `--output-format stream-json` |

## Root Cause Analysis

### Problem 1: Missing Gemini in README

**Root Cause**: The Gemini CLI tool was added to the codebase in a previous update (gemini.mjs created, index.mjs updated), but the README.md Supported Tools table was not updated to include this new tool.

**Evidence**:
- `js/src/tools/gemini.mjs` exists with full implementation (318 lines)
- `js/src/tools/index.mjs` imports and exports `geminiTool`
- README.md table only lists: claude, codex, opencode, qwen, agent

### Problem 2: Incorrect Agent JSON Input Status

**Root Cause**: Documentation lag - the Agent CLI's JSON input capability was either overlooked during initial documentation or the capability was added after documentation was written.

**Evidence**:
- `js/src/tools/agent.mjs:246` explicitly states `supportsJsonInput: true`
- @link-assistant/agent README states: "JSON Input/Output: Accepts JSON via stdin, outputs JSON event streams (OpenCode-compatible)"
- The code comments in agent.mjs line 71 confirm: "Agent uses stdin for prompt input (NDJSON streaming supported)"

## Timeline of Events

1. **Initial Release**: agent-commander released with support for claude, codex, opencode, agent, qwen
2. **Agent JSON Support**: Agent CLI implemented full JSON input/output (based on OpenCode compatibility)
3. **Gemini Addition**: Gemini CLI tool added to codebase (gemini.mjs created)
4. **Documentation Gap**: README.md not updated to reflect Gemini addition or Agent JSON input capability
5. **Issue #15**: Documentation inconsistency discovered and reported

## Solution Implementation

### Changes Made to README.md

1. **Added Gemini to Supported Tools Table**:
   ```markdown
   | `gemini` | Gemini CLI | ✅ (stream-json) | ❌ | `flash`, `pro`, `lite` |
   ```

2. **Fixed Agent JSON Input Status**:
   ```markdown
   | `agent` | @link-assistant/agent | ✅ | ✅ | `grok`, `sonnet`, `haiku` |
   ```

3. **Added Gemini-specific Features Section**:
   - Stream JSON format documentation
   - Yolo mode (auto-approval) documentation
   - Sandbox mode documentation
   - Checkpointing support documentation
   - Model configuration documentation

4. **Updated Feature List**:
   - Added `gemini` to the Multiple CLI Agents list
   - Updated description to include Gemini CLI

### Verification

| Tool | JSON Output | JSON Input | Verified Source |
|------|-------------|------------|-----------------|
| claude | ✅ (stream-json) | ✅ (stream-json) | Code + README |
| codex | ✅ | ❌ | Code analysis |
| opencode | ✅ | ❌ | Code analysis |
| qwen | ✅ (stream-json) | ✅ (stream-json) | Code + README |
| agent | ✅ | ✅ | Code + upstream README |
| gemini | ✅ (stream-json) | ❌ | Code + upstream README |

## Lessons Learned

1. **Documentation-Code Sync**: When adding new tools or capabilities, update documentation in the same commit/PR
2. **Verification Process**: Cross-reference code configurations with upstream tool documentation
3. **Case Studies**: Documenting the investigation helps prevent similar issues and provides institutional knowledge

## Files Modified

| File | Changes |
|------|---------|
| README.md | Added Gemini to table, fixed Agent JSON Input, added Gemini features section |
| docs/case-studies/issue-15/README.md | This case study document |
| docs/case-studies/issue-15/evidence-timeline.md | Investigation evidence and timeline |

## References

- [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) - Official Gemini CLI repository
- [@link-assistant/agent](https://github.com/link-assistant/agent) - Agent CLI repository
- [Gemini CLI Headless Mode](https://geminicli.com/docs/cli/headless/) - JSON output documentation
- [Issue #15](https://github.com/link-assistant/agent-commander/issues/15) - Original issue report

## Conclusion

The documentation discrepancies were caused by documentation lag rather than technical issues. The actual code implementations were correct - only the README.md needed updating to accurately reflect the supported tools and their capabilities.

Key insight: Maintaining accurate documentation requires systematic verification against both the codebase and upstream tool capabilities. Creating case studies for such investigations helps prevent similar issues and provides a reference for future contributors.
