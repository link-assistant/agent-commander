# agent-commander

[![npm version](https://img.shields.io/npm/v/agent-commander?label=npm&style=flat)](https://www.npmjs.com/package/agent-commander)
[![crates.io version](https://img.shields.io/crates/v/agent-commander?label=crates.io&style=flat)](https://crates.io/crates/agent-commander)
[![JavaScript CI/CD](https://github.com/link-assistant/agent-commander/actions/workflows/js.yml/badge.svg)](https://github.com/link-assistant/agent-commander/actions/workflows/js.yml)
[![Rust CI/CD](https://github.com/link-assistant/agent-commander/actions/workflows/rust.yml/badge.svg)](https://github.com/link-assistant/agent-commander/actions/workflows/rust.yml)

A JavaScript and Rust library to control agents enclosed in CLI commands like Anthropic Claude Code CLI, OpenAI Codex, OpenCode, Qwen Code, Gemini CLI, and @link-assistant/agent.

Built on the success of [hive-mind](https://github.com/link-assistant/hive-mind), `agent-commander` provides flexible language bindings and CLI tools for managing agent processes with various isolation levels.

Language-specific package documentation:

- [JavaScript package README](js/README.md)
- [Rust crate README](rust/README.md)
- [Shared concepts](docs/common-concepts.md)
- [Hive Mind parity audit and evidence](docs/case-studies/issue-50/README.md)
- [upcomputer and Hive Mind case study (launch options, usage windows, context usage, live input)](docs/case-studies/issue-57/README.md)
- [Dependency integration example](examples/hive-mind-dependency.mjs)

## Features

- **Universal Runtime Support**: Works with Node.js 22 or later, Bun, and Deno
- **Multiple CLI Agents**:
  - `claude` - Anthropic Claude Code CLI
  - `codex` - OpenAI Codex CLI
  - `opencode` - OpenCode CLI
  - `qwen` - Qwen Code CLI (Alibaba's AI coding agent)
  - `gemini` - Gemini CLI (Google's AI coding agent)
  - `agent` - @link-assistant/agent (OpenCode fork with native permission modes)
- **Multiple Isolation Modes**:
  - No isolation (direct execution)
  - Screen sessions (detached terminal sessions)
  - Docker containers (full containerization)
- **JSON Streaming Support**: NDJSON input/output for real-time message processing
- **Model Mapping**: Automatic mapping of model aliases to full model IDs
- **CLI & JavaScript Interface**: Use as a library or command-line tool
- **Graceful Shutdown**: CTRL+C handling with proper cleanup
- **Dry Run Mode**: Preview commands before execution
- **Attached/Detached Modes**: Monitor output in real-time or run in background
- **Read-only Planning Mode**: Enforce native no-shell/no-write restrictions for supported tools
- **Prompt File Input**: Pipe large prompts through files for stdin-based tools instead of embedding them in shell commands
- **Launch Options**: Reasoning effort, MCP servers, strict MCP config, extra directories and file attachments mapped onto each tool's native flag
- **Usage and Context Reporting**: Normalized subscription usage windows and context-window fill in the result metadata
- **Live Input**: Send follow-up messages to, and interrupt, a running Claude, Qwen or Agent session
- **Version Probe**: Check the installed CLI version against a minimum

## Installation

### As a global CLI tool

```bash
npm install -g agent-commander
```

### As a library

```bash
npm install agent-commander
```

### From the GitHub repository

```bash
npm install github:link-assistant/agent-commander
```

### For Deno

```javascript
import { agent } from "https://raw.githubusercontent.com/link-assistant/agent-commander/main/js/src/index.mjs";
```

### For Bun

```bash
bun add agent-commander
```

## Supported Tools

| Tool       | Description               | JSON Output      | JSON Input       | Read-only Mode                       | Model Aliases                                                   |
| ---------- | ------------------------- | ---------------- | ---------------- | ------------------------------------ | --------------------------------------------------------------- |
| `claude`   | Anthropic Claude Code CLI | ✅ (stream-json) | ✅ (stream-json) | ✅ `--permission-mode plan`          | `sonnet`, `opus`, `haiku`                                       |
| `codex`    | OpenAI Codex CLI          | ✅               | ❌               | ✅ `--sandbox read-only`             | `gpt-6-sol` (bundled default), `gpt-5.4`, `gpt5`, `o3`, `gpt4o` |
| `opencode` | OpenCode CLI              | ✅               | ❌               | ✅ `OPENCODE_PERMISSION` deny rules  | `grok`, `gemini`, `sonnet`                                      |
| `qwen`     | Qwen Code CLI             | ✅ (stream-json) | ✅ (stream-json) | ✅ `--approval-mode plan`            | `qwen3-coder`, `coder`, `gpt-4o`                                |
| `gemini`   | Gemini CLI                | ✅ (stream-json) | ❌               | ✅ `--approval-mode plan`            | `flash`, `pro`, `lite`                                          |
| `agent`    | @link-assistant/agent     | ✅               | ✅               | ✅ `--permission-mode readonly/plan` | `nemotron-3-super-free` (default), `grok`, `sonnet`, `haiku`    |

### Claude-specific Features

The Claude Code CLI supports additional features:

- **Stream JSON format**: Uses `--output-format stream-json` and `--input-format stream-json` for real-time streaming
- **Permission bypass**: Automatically includes `--dangerously-skip-permissions` by default for unrestricted operation; use read-only mode or `--skip-default-safety-flags` to supply a stricter native policy
- **Fallback model**: Use `--fallback-model` for automatic fallback when the primary model is overloaded
- **Session management**: Full support for `--session-id`, `--fork-session`, and `--resume`
- **System prompt appending**: Use `--append-system-prompt` to add to the default system prompt
- **Verbose mode**: Enable with `--verbose` for detailed output
- **User message replay**: Use `--replay-user-messages` for streaming acknowledgment

### Qwen-specific Features

The [Qwen Code CLI](https://github.com/QwenLM/qwen-code) supports additional features:

- **Stream JSON format**: Uses `--output-format stream-json` for real-time NDJSON streaming
- **Auto-approval mode**: Use `--yolo` flag for automatic action approval (enabled by default)
- **Session management**: Support for `--resume <sessionId>` and `--continue` for most recent session
- **Context options**: Use `--all-files` to include all files, `--include-directories` for specific dirs
- **Partial messages**: Use `--include-partial-messages` with stream-json for real-time UI updates
- **Model flexibility**: Supports Qwen3-Coder models plus OpenAI-compatible models via API

### Gemini-specific Features

The [Gemini CLI](https://github.com/google-gemini/gemini-cli) supports additional features:

- **Stream JSON format**: Uses `--output-format stream-json` for real-time NDJSON streaming
- **Auto-approval mode**: Use `--yolo` flag for automatic action approval (enabled by default)
- **Sandbox mode**: Use `--sandbox` flag for secure tool execution in isolated environment
- **Checkpointing**: Use `--checkpointing` to save project snapshots before file modifications
- **Debug output**: Use `-d` flag for detailed debug output
- **Model selection**: Use `-m` flag to select model (e.g., `gemini-2.5-flash`, `gemini-2.5-pro`)
- **Interactive mode**: Use `-i` flag with prompt to start interactive session

### Agent-specific Features

The [@link-assistant/agent](https://github.com/link-assistant/agent) supports additional features:

- **JSON Input/Output**: Accepts JSON via stdin, outputs JSON event streams (OpenCode-compatible)
- **Native permission system**: Enforceable `--permission-mode` (`auto` | `plan` | `readonly` | `ask`) plus an OpenCode-compatible `--permission` JSON policy (agent v0.24.0); `--read-only`/`--plan-only` map to it directly
- **Autonomous by default**: Runs with `--permission-mode auto` (full auto, never asks) unless a read-only/planning restriction is requested
- **13 built-in tools**: Including websearch, codesearch, batch - all enabled by default
- **MCP support**: Model Context Protocol for extending functionality with MCP servers
- **OpenCode compatibility**: 100% compatible with OpenCode's JSON event streaming format

### Read-only Planning Mode

Use `--read-only` or `--plan-only` when the selected agent should inspect and plan without shell execution or file mutation. The command builder maps the request to the safest native restriction available for each supported tool:

- `claude`: `--permission-mode plan`
- `codex`: `--ask-for-approval never exec --sandbox read-only`
- `opencode`: `OPENCODE_PERMISSION='{"edit":"deny","bash":"deny","task":"deny"}'`
- `qwen`: `--approval-mode plan`
- `gemini`: `--approval-mode plan`
- `agent`: `--permission-mode readonly` for `--read-only`, `--permission-mode plan` for `--plan-only`

Most tools treat `--plan-only` as an alias for `--read-only`. The `agent` tool honors its own distinction: `--read-only` selects the hard `readonly` mode (deny every edit and any non read-only shell command, never asks) while `--plan-only` selects `plan` (deny edits, allow read-only shell, ask before anything else). For fine-grained OpenCode-style policies, pass `agent`'s native `--permission '<json>'` through `--tool-arg`.

If a tool cannot enforce the requested restrictions, `start-agent` fails before starting the agent.

## CLI Usage

### start-agent

Start an agent with specified configuration:

```bash
start-agent --tool claude --working-directory "/tmp/dir" --prompt "Solve the issue"
```

#### Options

- `--tool <name>` - CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'qwen', 'gemini', 'agent') [required]
- `--working-directory <path>` - Working directory for the agent [required]
- `--prompt <text>` - Prompt for the agent
- `--prompt-file <path>` - Read prompt input from a file
- `--system-prompt <text>` - System prompt for the agent
- `--append-system-prompt <text>` - Append to the default system prompt (Claude only)
- `--model <name>` - Model to use (e.g., 'sonnet', 'opus', 'grok')
- `--fallback-model <name>` - Fallback model when default is overloaded (Claude only)
- `--reasoning-effort <level>` - Native reasoning effort (claude `--effort`, codex `model_reasoning_effort`, opencode `--variant`)
- `--mcp-config <path|json>` - MCP servers config (claude, codex, qwen)
- `--strict-mcp-config` - Use only the `--mcp-config` servers (claude)
- `--add-dir <dir>` - Extra directory the agent may access (repeatable; claude, codex, gemini, qwen)
- `--attach <file>` - Attach a file to the prompt (repeatable; codex `--image`, opencode `--file`)
- `--verbose` - Enable verbose mode (Claude only)
- `--read-only` - Enforce native read-only/planning mode for supported tools
- `--plan-only` - Alias for `--read-only` for most tools; the `agent` tool maps it to its softer `--permission-mode plan`
- `--resume <sessionId>` - Resume a previous session by ID
- `--session-id <uuid>` - Use a specific session ID (Claude only, must be valid UUID)
- `--fork-session` - Create new session ID when resuming (Claude only)
- `--replay-user-messages` - Re-emit user messages on stdout (Claude only, streaming mode)
- `--tool-executable <path>` - Override the native tool executable for any supported tool
- `--tool-env <KEY=VALUE>` - Add an environment variable to the native tool process (repeatable)
- `--tool-arg <arg>` - Append a raw native tool argument after agent-commander's typed arguments (repeatable)
- `--skip-default-safety-flags` - Suppress default autonomous bypass flags, including Qwen/Gemini `--yolo`, so callers can provide their own permission, sandbox, or approval flags
- `--isolation <mode>` - Isolation mode: none, screen, docker (default: none)
- `--screen-name <name>` - Screen session name (required for screen isolation)
- `--container-name <name>` - Container name (required for docker isolation)
- `--detached` - Run in detached mode
- `--dry-run` - Show command without executing
- `--help, -h` - Show help message

#### Examples

**Basic usage with Claude**

```bash
start-agent --tool claude --working-directory "/tmp/dir" --prompt "Hello" --model sonnet
```

**Using Codex**

```bash
start-agent --tool codex --working-directory "/tmp/dir" --prompt "Fix the bug" --model gpt5
```

**Using a prompt file for large prompts**

```bash
start-agent --tool codex --working-directory "/tmp/dir" \
  --prompt-file /tmp/agent-prompt.txt --model gpt-5.5
```

**Using @link-assistant/agent with Grok**

```bash
start-agent --tool agent --working-directory "/tmp/dir" --prompt "Analyze code" --model grok
```

**Using Qwen Code**

```bash
start-agent --tool qwen --working-directory "/tmp/dir" --prompt "Review this code" --model qwen3-coder
```

**Using Gemini**

```bash
start-agent --tool gemini --working-directory "/tmp/dir" --prompt "Explain this code" --model flash
```

**With model fallback (Claude)**

```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --prompt "Complex task" --model opus --fallback-model sonnet
```

**Native tool passthrough**

```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --prompt-file /tmp/agent-prompt.txt \
  --tool-executable /opt/claude-code/bin/claude \
  --tool-env MCP_TIMEOUT=10000 \
  --skip-default-safety-flags \
  --tool-arg --mcp-config --tool-arg /tmp/mcp.json \
  --tool-arg --permission-mode --tool-arg default
```

**Resume a session with fork (Claude)**

```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --resume abc123 --fork-session
```

**Read-only planning mode**

```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --prompt "Return a JSON implementation plan" --read-only
```

**Read-only planning mode with screen isolation**

```bash
start-agent --tool codex --working-directory "/tmp/dir" \
  --prompt "Inspect and plan only" --read-only \
  --isolation screen --screen-name planning-agent --detached
```

**With screen isolation (detached)**

```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --isolation screen --screen-name my-agent --detached
```

**With docker isolation (attached)**

```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --isolation docker --container-name my-agent
```

**Dry run**

```bash
start-agent --tool claude --working-directory "/tmp/dir" --dry-run
```

### stop-agent

Stop a detached agent:

```bash
stop-agent --isolation screen --screen-name my-agent
```

#### Options

- `--isolation <mode>` - Isolation mode: screen, docker [required]
- `--screen-name <name>` - Screen session name (required for screen isolation)
- `--container-name <name>` - Container name (required for docker isolation)
- `--dry-run` - Show command without executing
- `--help, -h` - Show help message

#### Examples

**Stop screen session**

```bash
stop-agent --isolation screen --screen-name my-agent
```

**Stop docker container**

```bash
stop-agent --isolation docker --container-name my-agent
```

## JavaScript API

### Basic Usage

```javascript
import { agent } from "agent-commander";

// Create an agent controller
const myAgent = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Analyze this code",
  systemPrompt: "You are a helpful assistant",
  model: "sonnet", // Optional: use model alias
});

// Start the agent (non-blocking, returns immediately)
await myAgent.start();

// Do other work while agent runs...

// Stop the agent and collect output
const result = await myAgent.stop();
console.log("Exit code:", result.exitCode);
console.log("Plain output:", result.output.plain);
console.log("Parsed output:", result.output.parsed); // JSON messages if supported
console.log("Session ID:", result.sessionId); // For resuming later
console.log("Usage:", result.usage); // Token usage statistics
console.log("Metadata:", result.metadata); // Normalized cross-tool summary
```

### Normalized Result Metadata

`stop()` returns `result.metadata` for all six supported tools. The metadata object gives callers a stable summary without tool-specific output parsing:

- `success`, `exitCode`, `signal`, `terminatedAfterResult`, `errorDuringExecution`, `errorType`, and `errorMessage`. `errorType` includes `rate_limited` (a transient server throttle: retry it), `incomplete_stream` (the process exited before the native completion event) and `background_tasks_stopped`. A process that `stop()` ends after its completed result is not a failure.
- `sessionId`
- `limitReached`, `limitResetTime`, `limitTimezone`, `limitResetsAt` (epoch seconds, from structured sources) and `limitWindow` (`5-hour`, `weekly`, ...)
- `limitSource`: set when the limit was found outside the output, as `codex-rollout` or `claude-transcript` (see below)
- `apiError`, `apiErrorStatus`, `terminalReason`, and `requestId` (Claude API failure details)
- `resultSummary`
- `anthropicTotalCostUSD`, `publicPricingEstimate`, and `pricingInfo`
- `resultModelUsage`, `streamTokenUsage`, `subAgentCalls`, `observedModels`, and `observedModel` (the models that actually answered)
- `runningBackgroundTasks`, `backgroundTasksStopped`, `stoppedBackgroundTasks`, and `printWaitCeilingSeconds`
- `usageWindows`: subscription windows (`{ id, kind, label, usedPercent, resetsAt, windowDurationMins }`) from Claude `rate_limit_event` messages and Codex `rate_limits`
- `contextUsage`: context-window fill (`{ usedTokens, peakTokens, maxTokens, usedPercent, model, compactions }`)

See [usage windows and context usage](docs/common-concepts.md#usage-windows-and-context-usage) for the sources of each field.

#### Usage limits that only the session files report

`codex exec --json` and `claude -p` do not always print a usage limit when they fail on one. For a failed run that ended on its own, without a signal and without a limit in its output, `stop()` checks the session file the CLI wrote:

- **Codex**: the last turn of `$CODEX_HOME/sessions/YYYY/MM/DD/rollout-*-<thread id>.jsonl`. It uses a `token_count` `rate_limits` window at 100% with a `resets_at`, or an `error` event with `usage_limit_exceeded`.
- **Claude**: `${CLAUDE_CONFIG_DIR:-~/.claude}/projects/<working-directory slug>/<session id>.jsonl`, when its last conversation entry is an `isApiErrorMessage` usage-limit message.

A `CODEX_HOME` or `CLAUDE_CONFIG_DIR` passed in `toolOptions.extraEnv` is honoured. Only the last turn or entry is read, so a limit the session recovered from is not reported. The same checks are exported for callers that run the CLIs themselves: `applyCodexRolloutUsageLimit`, `detectCodexRolloutUsageLimit`, `canResumeCodexSession` (a missing rollout means `codex exec resume` cannot work, so start a new session), `applyClaudeTranscriptUsageLimit` and `readClaudeTranscriptApiError`. Hive Mind's text classifiers are exported too: `detectUsageLimitSources`, `isUsageLimitText`, `extractResetTime` and `isRecoverableToolError`.

### Launch Options

```javascript
const controller = agent({
  tool: "codex",
  workingDirectory: "/tmp/project",
  prompt: "Compare the screenshot with the design",
  reasoningEffort: "high",
  mcpConfig: {
    mcpServers: { docs: { type: "http", url: "http://127.0.0.1:4100/mcp" } },
  },
  additionalDirectories: ["../shared"],
  attachments: ["screenshot.png"],
});
```

A tool without a native flag for an option throws before it starts. See the [launch option matrix](docs/common-concepts.md#launch-options).

### Live Input

```javascript
const controller = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Refactor the parser",
  liveInput: true,
});
await controller.start();
controller.sendMessage("Also keep the public API unchanged");
controller.interrupt(); // end the running turn (claude, qwen)
// stop() closes stdin after the last turn; endInput() closes it right away.
const result = await controller.stop();
```

### Tool Version Probe

```javascript
import { getToolVersion } from "agent-commander";

const { installed, version, meetsMinimum } = await getToolVersion({
  tool: "codex",
  minimumVersion: "0.163.0",
});
```

### Using Different Tools

```javascript
import { agent } from "agent-commander";

// Using Codex
const codexAgent = agent({
  tool: "codex",
  workingDirectory: "/tmp/project",
  prompt: "Fix this bug",
  model: "gpt5",
});

// Using OpenCode
const opencodeAgent = agent({
  tool: "opencode",
  workingDirectory: "/tmp/project",
  prompt: "Refactor this code",
  model: "grok",
});

// Using @link-assistant/agent
const linkAgent = agent({
  tool: "agent",
  workingDirectory: "/tmp/project",
  prompt: "Implement feature",
  model: "grok",
});

// Using Qwen Code
const qwenAgent = agent({
  tool: "qwen",
  workingDirectory: "/tmp/project",
  prompt: "Review this code",
  model: "qwen3-coder",
});

// Using Gemini CLI
const geminiAgent = agent({
  tool: "gemini",
  workingDirectory: "/tmp/project",
  prompt: "Explain this code",
  model: "flash",
});
```

### Read-only Planning

```javascript
import { agent } from "agent-commander";

const planner = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Inspect the codebase and return a task split plan",
  readOnly: true,
});

await planner.start({ dryRun: true });
```

### Streaming JSON Messages

```javascript
import { agent } from "agent-commander";

const myAgent = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Process this",
  json: true, // Enable JSON output mode
});

// Stream messages as they arrive
await myAgent.start({
  onMessage: (message) => {
    console.log("Received:", message);
  },
  onOutput: (chunk) => {
    // Raw output chunks
    console.log(chunk.type, chunk.data);
  },
});

const result = await myAgent.stop();
// result.output.parsed contains all JSON messages
```

### Using JSON Input/Output Streams

```javascript
import { createJsonInputStream, createJsonOutputStream } from "agent-commander";

// Create input stream for sending messages
const input = createJsonInputStream();
input.addSystemMessage({ content: "You are helpful" });
input.addPrompt({ content: "Analyze this code" });
console.log(input.toString()); // NDJSON format

// Parse streaming output
const output = createJsonOutputStream({
  onMessage: ({ message }) => console.log("Received:", message),
});

// Process chunks as they arrive
output.process({ chunk: '{"type":"hello"}\n' });
output.process({ chunk: '{"type":"done"}\n' });

// Get all messages
const messages = output.getMessages();
```

### With Screen Isolation

```javascript
import { agent } from "agent-commander";

const myAgent = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Run tests",
  isolation: "screen",
  screenName: "my-agent-session",
});

// Start in detached mode
await myAgent.start({ detached: true });

// Later, stop the agent
const result = await myAgent.stop();
console.log("Exit code:", result.exitCode);
```

### With Docker Isolation

```javascript
import { agent } from "agent-commander";

const myAgent = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Build the project",
  isolation: "docker",
  containerName: "my-agent-container",
});

// Start attached (stream output to console)
await myAgent.start({ attached: true });

// Stop the container and get results
const result = await myAgent.stop();
console.log("Exit code:", result.exitCode);
```

### Dry Run Mode

```javascript
const myAgent = agent({
  tool: "claude",
  workingDirectory: "/tmp/project",
  prompt: "Test command",
});

// Preview the command without executing (prints to console)
await myAgent.start({ dryRun: true });
```

### Tool Configuration API

```javascript
import { getTool, listTools, isToolSupported } from "agent-commander";

// List all available tools
console.log(listTools()); // ['claude', 'codex', 'opencode', 'agent', 'gemini', 'qwen']

// Check if a tool is supported
console.log(isToolSupported({ toolName: "claude" })); // true

// Get tool configuration
const claudeTool = getTool({ toolName: "claude" });
console.log(claudeTool.modelMap); // { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', ... }

// Map model alias to full ID
const fullId = claudeTool.mapModelToId({ model: "opus" });
console.log(fullId); // 'claude-opus-5-5'
```

## API Reference

### `agent(options)`

Creates an agent controller.

**Parameters:**

- `options.tool` (string, required) - CLI tool to use ('claude', 'codex', 'opencode', 'qwen', 'gemini', 'agent')
- `options.workingDirectory` (string, required) - Working directory
- `options.prompt` (string, optional) - Prompt for the agent
- `options.systemPrompt` (string, optional) - System prompt
- `options.promptFile` (string, optional) - File containing prompt input for stdin-based tools
- `options.model` (string, optional) - Model alias or full ID
- `options.json` (boolean, optional) - Enable JSON output mode
- `options.resume` (string, optional) - Resume session ID (tool-specific)
- `options.readOnly` (boolean, optional) - Enforce native read-only/planning mode
- `options.planOnly` (boolean, optional) - Enforce native planning mode; the `agent` tool maps it to `--permission-mode plan` while other tools treat it like `readOnly`
- `options.reasoningEffort` (string, optional) - Native reasoning effort / variant level
- `options.mcpConfig` (string or object, optional) - MCP servers: config path, inline JSON or `{mcpServers}` object
- `options.strictMcpConfig` (boolean, optional) - Use only the servers from `mcpConfig`
- `options.additionalDirectories` (string or string array, optional) - Extra directories the agent may access
- `options.attachments` (string or string array, optional) - Files attached to the prompt (codex images, opencode files)
- `options.liveInput` (boolean, optional) - Keep stdin open as a stream-json channel for `sendMessage()`, `interrupt()` and `endInput()` (claude, qwen, agent)
- `options.isolation` (string, optional) - 'none', 'screen', or 'docker' (default: 'none')
- `options.screenName` (string, optional) - Screen session name (required for screen isolation)
- `options.containerName` (string, optional) - Container name (required for docker isolation)
- `options.toolOptions` (object, optional) - Additional tool-specific options
  - `executable` (string, optional) - Override the native executable path/name for any supported tool
  - `extraEnv` (object or `KEY=VALUE` / `[key, value]` array, optional) - Environment variables applied to the native tool process. A `null` value unsets an inherited variable (`env -u`), for example `{ ANTHROPIC_API_KEY: null }`.
  - `extraArgs` (string array, optional) - Raw native tool arguments appended after typed agent-commander arguments
  - `skipDefaultSafetyFlags` (boolean, optional) - Do not add default autonomous safety bypass flags such as Claude/Codex bypass flags or Qwen/Gemini `--yolo`
  - `permissionMode` (string, optional) - Explicit permission mode for Claude or `agent` (agent: `auto` | `plan` | `readonly` | `ask`)
  - `permission` (string, optional) - OpenCode-compatible `--permission` JSON policy for the `agent` tool
  - `sandboxMode` (string, optional) - Explicit Codex sandbox mode
  - `approvalMode` (string, optional) - Explicit Codex approval mode

**Returns:** Agent controller object with `start()`, `stop()`, `cancel()`, `sendMessage()`, `interrupt()`, `endInput()`, `getSessionId()`, `getMessages()`, and `getToolConfig()` methods

### `controller.start(startOptions)`

Starts the agent (non-blocking - returns immediately after starting the process).

**Parameters:**

- `startOptions.dryRun` (boolean, optional) - Preview command without executing
- `startOptions.detached` (boolean, optional) - Run in detached mode
- `startOptions.attached` (boolean, optional) - Stream output (default: true)
- `startOptions.onMessage` (function, optional) - Callback for JSON messages
- `startOptions.onOutput` (function, optional) - Callback for raw output chunks

**Returns:** Promise resolving to `void` (or prints command in dry-run mode)

### `controller.stop(stopOptions)`

Stops the agent and collects output.

For `isolation: 'none'`: Waits for process to exit and collects all output.
For `isolation: 'screen'` or `'docker'`: Sends stop command to the isolated environment.

**Parameters:**

- `stopOptions.dryRun` (boolean, optional) - Preview command without executing
- `stopOptions.closeTimeoutMs` (number, optional) - Stop a process that stays alive this long after its final result (the Claude print-mode hang). The whole process group is stopped.
- `stopOptions.backgroundWaitMs` (number, optional) - Extra time allowed while the result reports background tasks that are still running

**Returns:** Promise resolving to:

```javascript
{
  exitCode: number,
  output: {
    plain: string,      // Raw text output (stdout + stderr)
    parsed: Array|null  // JSON-parsed messages (if tool supports it)
  },
  sessionId: string|null,  // Session ID for resuming
  usage: Object|null,      // Token usage statistics
  metadata: Object         // Normalized result metadata (see above)
}
```

### `createJsonInputStream(options)`

Creates a JSON input stream for building NDJSON input.

**Parameters:**

- `options.compact` (boolean, optional) - Use compact JSON (default: true)

**Returns:** JsonInputStream with `add()`, `addPrompt()`, `addSystemMessage()`, `toString()`, `toBuffer()` methods

### `createJsonOutputStream(options)`

Creates a JSON output stream for parsing NDJSON output.

**Parameters:**

- `options.onMessage` (function, optional) - Callback for each parsed message
- `options.onError` (function, optional) - Callback for parse errors

**Returns:** JsonOutputStream with `process()`, `flush()`, `getMessages()`, `filterByType()` methods

## Isolation Modes

### None (Default)

Direct execution without isolation. Agent runs as a child process.

**Use case:** Simple, quick execution with full system access

**CTRL+C:** Stops the agent gracefully

### Screen

Runs agent in a GNU Screen session.

**Use case:** Detached long-running tasks that can be reattached

**Requirements:** `screen` must be installed

**Management:**

```bash
# List sessions
screen -ls

# Reattach
screen -r my-agent-session

# Detach
Ctrl+A, then D
```

### Docker

Runs agent in a Docker container with working directory mounted.

**Use case:** Isolated, reproducible environments

**Requirements:** Docker must be installed and running

**Management:**

```bash
# List containers
docker ps -a

# View logs
docker logs my-agent-container

# Stop
stop-agent --isolation docker --container-name my-agent-container
```

## Development

### Running Tests

```bash
# Node.js
npm test

# Bun
bun test

# Deno
deno test --allow-read --allow-write --allow-run --allow-env --allow-net --allow-sys=osRelease test/**/*.test.mjs
```

### Running Examples

```bash
npm run example
```

### Linting

```bash
npm run lint
```

## Architecture

The library is built using patterns from [hive-mind](https://github.com/link-assistant/hive-mind) and uses:

- **use-m**: Dynamic module loading from CDN
- **command-stream**: Asynchronous command execution with streaming output

### Project Structure

```
agent-commander/
├── package.json               # Root manifest for GitHub npm installs
├── js/
│   ├── src/                   # JavaScript library source
│   ├── bin/                   # start-agent and stop-agent CLIs
│   ├── test/                  # JavaScript tests
│   ├── examples/              # JavaScript usage examples
│   └── package.json           # Published npm package manifest
├── rust/
│   ├── src/                   # Rust library and CLI source
│   ├── tests/                 # Rust tests
│   └── Cargo.toml             # Published crate manifest
├── scripts/                   # Release, changelog, and CI helpers
└── .github/workflows/         # js.yml, rust.yml, and e2e workflows
```

## Contributing

Contributions are welcome! Please ensure:

1. All tests pass: `npm test`
2. Code is linted: `npm run lint`
3. Tests work on Node.js, Bun, and Deno

## License

This is free and unencumbered software released into the public domain. See [LICENSE](LICENSE) for details.

## Acknowledgments

- Inspired by [hive-mind](https://github.com/link-assistant/hive-mind) - Distributed AI orchestration platform
- Testing infrastructure based on [test-anywhere](https://github.com/link-foundation/test-anywhere)
- Based on best experience from [@link-assistant/agent](https://github.com/link-assistant/agent)

## Related Projects

- [hive-mind](https://github.com/link-assistant/hive-mind) - Multi-agent GitHub issue solver
- [@link-assistant/agent](https://github.com/link-assistant/agent) - OpenCode fork for autonomous agents with a native permission system
- [test-anywhere](https://github.com/link-foundation/test-anywhere) - Universal JavaScript testing
