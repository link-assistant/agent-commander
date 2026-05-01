# agent-commander

[![npm version](https://img.shields.io/npm/v/agent-commander?label=npm&style=flat)](https://www.npmjs.com/package/agent-commander)
[![JavaScript CI/CD](https://github.com/link-assistant/agent-commander/actions/workflows/js.yml/badge.svg)](https://github.com/link-assistant/agent-commander/actions/workflows/js.yml)

JavaScript bindings and CLI tools for controlling AI coding agents through their native command-line interfaces.

This package supports Node.js, Bun, and Deno. It provides `start-agent` and `stop-agent` binaries plus a library API for process management, isolation, JSON streaming, model aliasing, and read-only planning mode.

## Install

```bash
npm install agent-commander
```

```bash
npm install -g agent-commander
```

```bash
bun add agent-commander
```

For Deno, import the module directly from the repository:

```javascript
import { agent } from 'https://raw.githubusercontent.com/link-assistant/agent-commander/main/js/src/index.mjs';
```

## CLI

```bash
start-agent --tool claude --working-directory "/tmp/project" --prompt "Inspect this project"
```

```bash
start-agent --tool claude --working-directory "/tmp/project" \
  --prompt "Plan the change" --read-only --model opus --fallback-model sonnet
```

```bash
start-agent --tool codex --working-directory "/tmp/project" \
  --prompt "Run a focused review" --isolation screen --screen-name review-agent --detached
```

Common options:

- `--tool <name>`: `claude`, `codex`, `opencode`, `qwen`, `gemini`, or `agent`
- `--working-directory <path>`: directory where the agent command runs
- `--prompt <text>` and `--system-prompt <text>`: user and system prompts
- `--prompt-file <path>`: read prompt input from a file for stdin-based tools
- `--model <name>`: tool-specific model alias or full model name
- `--read-only` or `--plan-only`: enforce native planning/no-write mode when supported
- `--tool-executable <path>`: override the native executable for any supported tool
- `--tool-env <KEY=VALUE>`: add an environment variable to the native tool process, repeatable
- `--tool-arg <arg>`: append a raw native tool argument, repeatable
- `--skip-default-safety-flags`: suppress default autonomous safety bypass flags, including Qwen/Gemini `--yolo`
- `--isolation <mode>`: `none`, `screen`, or `docker`
- `--dry-run`: print the command without executing it

Claude-specific options include `--append-system-prompt`, `--fallback-model`, `--session-id`, `--fork-session`, `--verbose`, and `--replay-user-messages`.

## Library

```javascript
import { agent } from 'agent-commander';

const controller = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Return a short implementation plan',
  model: 'sonnet',
  readOnly: true,
});

await controller.start({ attached: false });
const result = await controller.stop();

console.log(result.exitCode);
console.log(result.output.plain);
console.log(result.metadata);
```

`result.metadata` is a normalized summary for `claude`, `codex`, `opencode`, and `agent` runs. It includes success and error classification, session ID, usage-limit reset details, result summary, cost estimates, stream token usage, optional model usage, and sub-agent call summaries.

For large generated prompts, pass `promptFile` or let the controller create a temporary prompt file automatically for `claude`, `codex`, `opencode`, `agent`, `qwen`, and `gemini`:

```javascript
const controller = agent({
  tool: 'codex',
  workingDirectory: '/tmp/project',
  promptFile: '/tmp/agent-prompt.txt',
  model: 'gpt-5.5',
});
```

Pass tool-specific options through `toolOptions`:

```javascript
const controller = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Continue the previous investigation',
  resume: 'abc123',
  toolOptions: {
    fallbackModel: 'sonnet',
    appendSystemPrompt: 'Prefer concise findings.',
    replayUserMessages: true,
  },
});
```

For parity with fast-moving native CLIs, pass raw executable, environment, and argument overrides for any supported tool through `toolOptions`:

```javascript
const controller = agent({
  tool: 'codex',
  workingDirectory: '/tmp/project',
  promptFile: '/tmp/agent-prompt.txt',
  toolOptions: {
    executable: '/opt/codex/bin/codex',
    extraEnv: { CODEX_HOME: '/tmp/codex-home' },
    extraArgs: ['--config', 'model_reasoning_effort="high"'],
    skipDefaultSafetyFlags: true,
    sandboxMode: 'workspace-write',
    approvalMode: 'never',
  },
});
```

## Shared Behavior

JavaScript and Rust expose the same core concepts:

- Tool selection and model alias mapping
- `none`, `screen`, and `docker` isolation modes
- Dry-run command preview
- JSON/NDJSON output parsing for tools that support it
- Read-only planning mode for tools with enforceable native restrictions

See [shared concepts](../docs/common-concepts.md) for behavior that should stay aligned across both packages.

## Release Flow

JavaScript releases use Changesets:

```bash
npm run changeset
npm run changeset:version
npm run changeset:publish
```

The GitHub Release workflow publishes language-specific releases with `js_` tags and `[JavaScript] vX.Y.Z` release names.

## Test

```bash
npm test
npm run lint
npm run format:check
```
