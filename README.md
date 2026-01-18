# agent-commander

A JavaScript library to control agents enclosed in CLI commands like Anthropic Claude Code CLI, OpenAI Codex, OpenCode, Qwen Code, and @link-assistant/agent.

Built on the success of [hive-mind](https://github.com/link-assistant/hive-mind), `agent-commander` provides a flexible JavaScript interface and CLI tools for managing agent processes with various isolation levels.

## Features

- **Universal Runtime Support**: Works with Node.js, Bun, and Deno
- **Multiple CLI Agents**:
  - `claude` - Anthropic Claude Code CLI
  - `codex` - OpenAI Codex CLI
  - `opencode` - OpenCode CLI
  - `qwen` - Qwen Code CLI (Alibaba's AI coding agent)
  - `agent` - @link-assistant/agent (unrestricted OpenCode fork)
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

## Installation

### As a global CLI tool

```bash
npm install -g agent-commander
```

### As a library

```bash
npm install agent-commander
```

### For Deno

```javascript
import { agent } from 'https://raw.githubusercontent.com/link-assistant/agent-commander/main/src/index.mjs';
```

### For Bun

```bash
bun add agent-commander
```

## Supported Tools

| Tool | Description | JSON Output | JSON Input | Model Aliases |
|------|-------------|-------------|------------|---------------|
| `claude` | Anthropic Claude Code CLI | ✅ (stream-json) | ✅ (stream-json) | `sonnet`, `opus`, `haiku` |
| `codex` | OpenAI Codex CLI | ✅ | ❌ | `gpt5`, `o3`, `gpt4o` |
| `opencode` | OpenCode CLI | ✅ | ❌ | `grok`, `gemini`, `sonnet` |
| `qwen` | Qwen Code CLI | ✅ (stream-json) | ✅ (stream-json) | `qwen3-coder`, `coder`, `gpt-4o` |
| `agent` | @link-assistant/agent | ✅ | ❌ | `grok`, `sonnet`, `haiku` |

### Claude-specific Features

The Claude Code CLI supports additional features:

- **Stream JSON format**: Uses `--output-format stream-json` and `--input-format stream-json` for real-time streaming
- **Permission bypass**: Automatically includes `--dangerously-skip-permissions` for unrestricted operation
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

## CLI Usage

### start-agent

Start an agent with specified configuration:

```bash
start-agent --tool claude --working-directory "/tmp/dir" --prompt "Solve the issue"
```

#### Options

- `--tool <name>` - CLI tool to use (e.g., 'claude', 'codex', 'opencode', 'qwen', 'agent') [required]
- `--working-directory <path>` - Working directory for the agent [required]
- `--prompt <text>` - Prompt for the agent
- `--system-prompt <text>` - System prompt for the agent
- `--append-system-prompt <text>` - Append to the default system prompt (Claude only)
- `--model <name>` - Model to use (e.g., 'sonnet', 'opus', 'grok')
- `--fallback-model <name>` - Fallback model when default is overloaded (Claude only)
- `--verbose` - Enable verbose mode (Claude only)
- `--resume <sessionId>` - Resume a previous session by ID
- `--session-id <uuid>` - Use a specific session ID (Claude only, must be valid UUID)
- `--fork-session` - Create new session ID when resuming (Claude only)
- `--replay-user-messages` - Re-emit user messages on stdout (Claude only, streaming mode)
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

**Using @link-assistant/agent with Grok**
```bash
start-agent --tool agent --working-directory "/tmp/dir" --prompt "Analyze code" --model grok
```

**Using Qwen Code**
```bash
start-agent --tool qwen --working-directory "/tmp/dir" --prompt "Review this code" --model qwen3-coder
```

**With model fallback (Claude)**
```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --prompt "Complex task" --model opus --fallback-model sonnet
```

**Resume a session with fork (Claude)**
```bash
start-agent --tool claude --working-directory "/tmp/dir" \
  --resume abc123 --fork-session
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
import { agent } from 'agent-commander';

// Create an agent controller
const myAgent = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Analyze this code',
  systemPrompt: 'You are a helpful assistant',
  model: 'sonnet', // Optional: use model alias
});

// Start the agent (non-blocking, returns immediately)
await myAgent.start();

// Do other work while agent runs...

// Stop the agent and collect output
const result = await myAgent.stop();
console.log('Exit code:', result.exitCode);
console.log('Plain output:', result.output.plain);
console.log('Parsed output:', result.output.parsed); // JSON messages if supported
console.log('Session ID:', result.sessionId); // For resuming later
console.log('Usage:', result.usage); // Token usage statistics
```

### Using Different Tools

```javascript
import { agent } from 'agent-commander';

// Using Codex
const codexAgent = agent({
  tool: 'codex',
  workingDirectory: '/tmp/project',
  prompt: 'Fix this bug',
  model: 'gpt5',
});

// Using OpenCode
const opencodeAgent = agent({
  tool: 'opencode',
  workingDirectory: '/tmp/project',
  prompt: 'Refactor this code',
  model: 'grok',
});

// Using @link-assistant/agent
const linkAgent = agent({
  tool: 'agent',
  workingDirectory: '/tmp/project',
  prompt: 'Implement feature',
  model: 'grok',
});

// Using Qwen Code
const qwenAgent = agent({
  tool: 'qwen',
  workingDirectory: '/tmp/project',
  prompt: 'Review this code',
  model: 'qwen3-coder',
});
```

### Streaming JSON Messages

```javascript
import { agent } from 'agent-commander';

const myAgent = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Process this',
  json: true, // Enable JSON output mode
});

// Stream messages as they arrive
await myAgent.start({
  onMessage: (message) => {
    console.log('Received:', message);
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
import { createJsonInputStream, createJsonOutputStream } from 'agent-commander';

// Create input stream for sending messages
const input = createJsonInputStream();
input.addSystemMessage({ content: 'You are helpful' });
input.addPrompt({ content: 'Analyze this code' });
console.log(input.toString()); // NDJSON format

// Parse streaming output
const output = createJsonOutputStream({
  onMessage: ({ message }) => console.log('Received:', message),
});

// Process chunks as they arrive
output.process({ chunk: '{"type":"hello"}\n' });
output.process({ chunk: '{"type":"done"}\n' });

// Get all messages
const messages = output.getMessages();
```

### With Screen Isolation

```javascript
import { agent } from 'agent-commander';

const myAgent = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Run tests',
  isolation: 'screen',
  screenName: 'my-agent-session',
});

// Start in detached mode
await myAgent.start({ detached: true });

// Later, stop the agent
const result = await myAgent.stop();
console.log('Exit code:', result.exitCode);
```

### With Docker Isolation

```javascript
import { agent } from 'agent-commander';

const myAgent = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Build the project',
  isolation: 'docker',
  containerName: 'my-agent-container',
});

// Start attached (stream output to console)
await myAgent.start({ attached: true });

// Stop the container and get results
const result = await myAgent.stop();
console.log('Exit code:', result.exitCode);
```

### Dry Run Mode

```javascript
const myAgent = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Test command',
});

// Preview the command without executing (prints to console)
await myAgent.start({ dryRun: true });
```

### Tool Configuration API

```javascript
import { getTool, listTools, isToolSupported } from 'agent-commander';

// List all available tools
console.log(listTools()); // ['claude', 'codex', 'opencode', 'agent', 'qwen']

// Check if a tool is supported
console.log(isToolSupported({ toolName: 'claude' })); // true

// Get tool configuration
const claudeTool = getTool({ toolName: 'claude' });
console.log(claudeTool.modelMap); // { sonnet: 'claude-sonnet-4-5-...', ... }

// Map model alias to full ID
const fullId = claudeTool.mapModelToId({ model: 'opus' });
console.log(fullId); // 'claude-opus-4-5-20251101'
```

## API Reference

### `agent(options)`

Creates an agent controller.

**Parameters:**
- `options.tool` (string, required) - CLI tool to use ('claude', 'codex', 'opencode', 'qwen', 'agent')
- `options.workingDirectory` (string, required) - Working directory
- `options.prompt` (string, optional) - Prompt for the agent
- `options.systemPrompt` (string, optional) - System prompt
- `options.model` (string, optional) - Model alias or full ID
- `options.json` (boolean, optional) - Enable JSON output mode
- `options.resume` (string, optional) - Resume session ID (tool-specific)
- `options.isolation` (string, optional) - 'none', 'screen', or 'docker' (default: 'none')
- `options.screenName` (string, optional) - Screen session name (required for screen isolation)
- `options.containerName` (string, optional) - Container name (required for docker isolation)
- `options.toolOptions` (object, optional) - Additional tool-specific options

**Returns:** Agent controller object with `start()`, `stop()`, `getSessionId()`, `getMessages()`, and `getToolConfig()` methods

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

**Returns:** Promise resolving to:
```javascript
{
  exitCode: number,
  output: {
    plain: string,      // Raw text output (stdout + stderr)
    parsed: Array|null  // JSON-parsed messages (if tool supports it)
  },
  sessionId: string|null,  // Session ID for resuming
  usage: Object|null       // Token usage statistics
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
deno test --allow-read --allow-run --allow-env --allow-net test/**/*.test.mjs
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
├── src/
│   ├── index.mjs              # Main library interface
│   ├── command-builder.mjs    # Command string construction
│   ├── executor.mjs           # Command execution logic
│   ├── cli-parser.mjs         # CLI argument parsing
│   ├── tools/                 # Tool configurations
│   │   ├── index.mjs          # Tool registry
│   │   ├── claude.mjs         # Claude Code CLI config
│   │   ├── codex.mjs          # Codex CLI config
│   │   ├── opencode.mjs       # OpenCode CLI config
│   │   ├── qwen.mjs           # Qwen Code CLI config
│   │   └── agent.mjs          # @link-assistant/agent config
│   ├── streaming/             # JSON streaming utilities
│   │   ├── index.mjs          # Stream exports
│   │   ├── ndjson.mjs         # NDJSON parsing/stringify
│   │   ├── input-stream.mjs   # Input stream builder
│   │   └── output-stream.mjs  # Output stream parser
│   └── utils/
│       └── loader.mjs         # use-m integration
├── bin/
│   ├── start-agent.mjs        # CLI: start-agent
│   └── stop-agent.mjs         # CLI: stop-agent
├── test/                      # Test files
├── examples/                  # Usage examples
└── .github/workflows/         # CI/CD pipelines
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
- [@link-assistant/agent](https://github.com/link-assistant/agent) - Unrestricted OpenCode fork for autonomous agents
- [test-anywhere](https://github.com/link-foundation/test-anywhere) - Universal JavaScript testing
