# agent-commander

A JavaScript library to control agents enclosed in CLI commands like Anthropic Claude Code CLI.

Built on the success of [hive-mind](https://github.com/deep-assistant/hive-mind), `agent-commander` provides a flexible JavaScript interface and CLI tools for managing agent processes with various isolation levels.

## Features

- **Universal Runtime Support**: Works with Node.js, Bun, and Deno
- **Multiple Isolation Modes**:
  - No isolation (direct execution)
  - Screen sessions (detached terminal sessions)
  - Docker containers (full containerization)
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
import { agent } from 'https://raw.githubusercontent.com/deep-assistant/agent-commander/main/src/index.mjs';
```

### For Bun

```bash
bun add agent-commander
```

## CLI Usage

### start-agent

Start an agent with specified configuration:

```bash
start-agent --tool claude --working-directory "/tmp/dir" --prompt "Solve the issue"
```

#### Options

- `--tool <name>` - CLI tool to use (e.g., 'claude') [required]
- `--working-directory <path>` - Working directory for the agent [required]
- `--prompt <text>` - Prompt for the agent
- `--system-prompt <text>` - System prompt for the agent
- `--isolation <mode>` - Isolation mode: none, screen, docker (default: none)
- `--screen-name <name>` - Screen session name (required for screen isolation)
- `--container-name <name>` - Container name (required for docker isolation)
- `--detached` - Run in detached mode
- `--dry-run` - Show command without executing
- `--help, -h` - Show help message

#### Examples

**Basic usage (no isolation)**
```bash
start-agent --tool claude --working-directory "/tmp/dir" --prompt "Hello"
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
});

// Start the agent (non-blocking, returns immediately)
await myAgent.start();

// Do other work while agent runs...

// Stop the agent and collect output
const result = await myAgent.stop();
console.log('Exit code:', result.exitCode);
console.log('Plain output:', result.output.plain);
console.log('Parsed output:', result.output.parsed); // JSON messages if supported
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

## API Reference

### `agent(options)`

Creates an agent controller.

**Parameters:**
- `options.tool` (string, required) - CLI tool to use
- `options.workingDirectory` (string, required) - Working directory
- `options.prompt` (string, optional) - Prompt for the agent
- `options.systemPrompt` (string, optional) - System prompt
- `options.isolation` (string, optional) - 'none', 'screen', or 'docker' (default: 'none')
- `options.screenName` (string, optional) - Screen session name (required for screen isolation)
- `options.containerName` (string, optional) - Container name (required for docker isolation)

**Returns:** Agent controller object with `start()` and `stop()` methods

### `controller.start(startOptions)`

Starts the agent (non-blocking - returns immediately after starting the process).

**Parameters:**
- `startOptions.dryRun` (boolean, optional) - Preview command without executing
- `startOptions.detached` (boolean, optional) - Run in detached mode
- `startOptions.attached` (boolean, optional) - Stream output (default: true)

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
    parsed: Array|null  // JSON-parsed messages (if tool supports it, e.g., Claude)
  }
}
```

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

The library is built using patterns from [hive-mind](https://github.com/deep-assistant/hive-mind) and uses:

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

- Inspired by [hive-mind](https://github.com/deep-assistant/hive-mind) - Distributed AI orchestration platform
- Testing infrastructure based on [test-anywhere](https://github.com/link-foundation/test-anywhere)

## Related Projects

- [hive-mind](https://github.com/deep-assistant/hive-mind) - Multi-agent GitHub issue solver
- [test-anywhere](https://github.com/link-foundation/test-anywhere) - Universal JavaScript testing
