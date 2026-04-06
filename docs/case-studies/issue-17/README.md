# Case Study: Sync with hive-mind (Issue #17)

## Problem Statement

The agent-commander library was originally built using patterns from [hive-mind](https://github.com/link-assistant/hive-mind) on **2025-11-11** (commit `bd25d5a`). Since then, hive-mind has continued to evolve rapidly (now at v1.46.5 with 1500+ issues/PRs), while agent-commander's model configurations and logic have not been refreshed.

## Investigation Timeline

| Date | Event |
|------|-------|
| 2025-11-11 | Initial sync: agent-commander proof of concept created from hive-mind patterns |
| 2025-11-27 — 2026-01-10 | Independent evolution: Added Qwen, Gemini, expanded capabilities |
| 2025-12-29 | Rust translation added |
| 2026-04-05 | This sync (Issue #17): ~5 months since initial sync |

## Key Findings

### 1. Model Map Drift

**Claude models** were outdated:
- hive-mind updated to Claude Opus 4.6 and Sonnet 4.6 (Issues #1221, #1238, #1329, #1433)
- agent-commander still pointed `sonnet` → `claude-sonnet-4-5-20250929` and `opus` → `claude-opus-4-5-20251101`
- hive-mind added `opusplan` mode (Opus for planning, Sonnet for execution)
- hive-mind added version aliases (`sonnet-4-6`, `opus-4-5`, etc.) for backward compatibility

**Agent models** were significantly behind:
- hive-mind changed default from `grok-code-fast-1` to `minimax-m2.5-free` (Issue #1391)
- hive-mind added Kilo Gateway free models: `glm-5-free`, `glm-4.5-air-free`, `deepseek-r1-free`, `giga-potato-free`, `trinity-large-preview` (Issue #1282, #1300)
- hive-mind fixed `gpt-5-nano` provider prefix from `openai/` to `opencode/`
- hive-mind added deprecated model aliases for backward compatibility

### 2. Architectural Differences (By Design)

agent-commander is intentionally a **thin configuration/utility layer** while hive-mind is a **full execution engine**. These differences are architectural and should remain:

| Feature | agent-commander | hive-mind |
|---------|----------------|-----------|
| Role | Build CLI args, parse output | Full execution with retry, streaming, error recovery |
| Dependencies | Zero (self-contained) | Many (command-stream, sentry, fs, etc.) |
| Error handling | Basic detection | Multi-layer: streaming + post-hoc + fallback |
| Retry logic | None (left to caller) | Exponential backoff with session preservation |
| Token tracking | Post-hoc from output | Streaming accumulation + JSONL dedup |

### 3. Features Unique to Each

**agent-commander has (not in hive-mind):**
- Gemini CLI tool support (full implementation)
- Qwen Code CLI tool support (full implementation)
- Rust implementation alongside JavaScript
- Docker and screen isolation wrappers
- Deno runtime support

**hive-mind has (potential future syncs):**
- Connection validation with retry (`validateClaudeConnection`, `validateAgentConnection`)
- Centralized model registry (`models/index.mjs`) with validation and fuzzy matching
- `[1m]` suffix for 1M token context window
- `isStderrError()` smart stderr filtering
- Process tree killing via `-pid`
- Unicode sanitization on all parsed JSON
- Stdin piping for prompts (avoids shell escaping issues)
- Sentry error reporting integration
- Model pricing calculation via models.dev API

### 4. Industry Context

Research into AI orchestration best practices (2026) reveals alignment with agent-commander's approach:

- **Multi-model abstraction** is now standard: LangGraph, CrewAI, AutoGen all support model-agnostic agent definitions
- **Model tiering** (cheap models for triage, capable for reasoning) matches hive-mind's `opusplan` mode
- **Standardized tool interfaces** via MCP (Anthropic's Model Context Protocol) aligns with agent-commander's unified tool trait
- **Cost optimization** through model mixing (40-60% savings reported) validates the multi-provider approach

Sources:
- [AI Orchestration Platforms Compared (2026)](https://www.domo.com/learn/article/best-ai-orchestration-platforms)
- [Best Multi-Agent Frameworks 2026](https://gurusup.com/blog/best-multi-agent-frameworks-2026)
- [LangGraph Agent Orchestration](https://www.langchain.com/langgraph)

## Changes Made

### Synced from hive-mind

1. **Claude model map update** (JS + Rust):
   - `sonnet` → `claude-sonnet-4-6` (was `claude-sonnet-4-5-20250929`)
   - `opus` → `claude-opus-4-6` (was `claude-opus-4-5-20251101`)
   - Added `opusplan` special mode
   - Added version aliases: `sonnet-4-6`, `opus-4-6`, `opus-4-5`, `sonnet-4-5`, `haiku-4-5`
   - Added full model ID aliases for backward compatibility

2. **Agent model map update** (JS + Rust):
   - Added `minimax-m2.5-free` (new hive-mind default)
   - Added Kilo Gateway models: `glm-5-free`, `glm-4.5-air-free`, `deepseek-r1-free`, `giga-potato-free`, `trinity-large-preview`
   - Added deprecated models for backward compatibility: `kimi-k2.5-free`, `glm-4.7-free`, `minimax-m2.1-free`
   - Fixed `gpt-5-nano` provider prefix: `openai/` → `opencode/`
   - Updated default model: `grok-code-fast-1` → `minimax-m2.5-free`

### Not synced (future work)

These features exist in hive-mind but are not synced in this PR because they belong to the execution layer rather than the configuration layer:

- Connection validation and retry logic
- Centralized model validation with fuzzy matching
- `[1m]` context window suffix support
- Smart stderr filtering
- Streaming token accumulation
- Unicode sanitization
- Sentry integration
- Process tree management

## Recommendations for Future Syncs

1. **Establish a sync schedule**: Check hive-mind monthly for model map updates
2. **Consider centralized model registry**: Extract model data to a shared module (like hive-mind's `models/index.mjs`)
3. **Add model validation**: Fuzzy matching and "did you mean?" suggestions would improve UX
4. **Consider `[1m]` suffix support**: Claude models support 1M token context windows
5. **Monitor new tool additions**: hive-mind may add Gemini/Qwen support in the future
