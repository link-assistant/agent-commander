# agent-commander

[![npm version](https://img.shields.io/npm/v/agent-commander?label=npm&style=flat)](https://www.npmjs.com/package/agent-commander)
[![JavaScript CI/CD](https://github.com/link-assistant/agent-commander/actions/workflows/js.yml/badge.svg)](https://github.com/link-assistant/agent-commander/actions/workflows/js.yml)

JavaScript bindings and CLI tools for controlling AI coding agents through their native command-line interfaces.

This package supports Node.js 22 or later, Bun, and Deno. It provides `start-agent` and `stop-agent` binaries plus a library API for process management, isolation, JSON streaming, model aliasing, and read-only planning mode.

On Windows, Deno also needs `--allow-sys=osRelease` for terminal color detection in command-stream's dependencies.

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
- `--approve-each` (alias `--permission-mode ask`): approve each command, relaying native permission prompts as normalized NDJSON (supported for `agent` and `claude`)
- `--tool-executable <path>`: override the native executable for any supported tool
- `--tool-env <KEY=VALUE>`: add an environment variable to the native tool process, repeatable
- `--tool-arg <arg>`: append a raw native tool argument, repeatable
- `--skip-default-safety-flags`: suppress default autonomous safety bypass flags, including Qwen/Gemini `--yolo`
- `--reasoning-effort <level>`: native reasoning effort (claude `--effort`, codex `model_reasoning_effort`, opencode `--variant`)
- `--mcp-config <path|json>` and `--strict-mcp-config`: MCP servers (claude, codex, qwen; strict for claude)
- `--add-dir <dir>`: extra directory the agent may access, repeatable (claude, codex, gemini, qwen)
- `--attach <file>`: attach a file to the prompt, repeatable (codex `--image`, opencode `--file`)
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

`result.metadata` is a normalized summary for all six supported tools. It includes success and error classification, session ID, usage-limit reset details, result summary, cost estimates, stream token usage, optional model usage, and sub-agent call summaries.

### Completion, usage and cancellation

For direct JSON runs, `metadata.success` requires a native terminal event and a successful process exit. Empty or unfinished streams report `incomplete_stream`; stderr stays in `output.plain` while parsed events, session IDs and usage come from stdout. Agent's default NDJSON mode uses the same check. Parent session metadata excludes Claude subagent-scoped results.

`stop()` waits for a direct process to finish. Use `await controller.cancel()` to interrupt it and collect the final result. Unix cancellation signals the process group; Windows cancellation signals the immediate child. A native CLI that ignores SIGTERM needs a caller-managed termination policy.

`stop({ closeTimeoutMs, backgroundWaitMs })` ends a process that stays alive after its final result (the Claude print-mode hang, hive-mind#1280). It allows `backgroundWaitMs` more while the result reports running background tasks. Such a run keeps `success: true` with `terminatedAfterResult: true`. `metadata` also reports `signal`, `limitResetsAt`, `limitWindow`, `apiError`, `apiErrorStatus`, `terminalReason`, `requestId`, `observedModels`, and the background-task fields.

When a failed Codex or Claude run did not print its usage limit, `stop()` reads the last turn of the Codex rollout or the last entry of the Claude transcript and sets `limitSource` to `codex-rollout` or `claude-transcript` (hive-mind#3570). `canResumeCodexSession({ threadId, codexHome })` tells whether `codex exec resume` can find a thread (hive-mind#2888). `detectUsageLimitSources` and `isRecoverableToolError` are Hive Mind's classifiers.

Usage preserves native final totals without adding repeated assistant snapshots. Codex `inputTokens` means fresh input; inclusive input is `inputTokens + cacheReadTokens`. Cache and reasoning fields are reported when supplied. Gemini and Qwen expose token usage and native model usage through the same result contract.

Bundled aliases track a recorded Hive Mind catalogue (v2.39.5: `sonnet` is `claude-sonnet-5-5`, `opus` is `claude-opus-5-5`); exact model IDs pass through for caller-managed live discovery. Omitting `model` leaves selection to the native CLI. Claude's `opus` execution alias stays rolling. Common `resume` works for all six tools; Agent adds `--no-fork`, and OpenCode uses `--session`.

See the [parity audit](../docs/case-studies/issue-50/README.md) and [dependency example](../examples/hive-mind-dependency.mjs), which can run against a credential-free fixture for any tool.

### Launch options, live input and run telemetry

```javascript
import { agent, getToolVersion } from 'agent-commander';

const { meetsMinimum } = await getToolVersion({
  tool: 'claude',
  minimumVersion: '2.0.0',
});

const controller = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Refactor the parser',
  reasoningEffort: 'high',
  mcpConfig: {
    mcpServers: { docs: { type: 'http', url: 'http://127.0.0.1:4100/mcp' } },
  },
  strictMcpConfig: true,
  additionalDirectories: ['../shared'],
  liveInput: true,
});
await controller.start();
controller.sendMessage('Keep the public API unchanged');
const result = await controller.stop();
console.log(result.metadata.usageWindows, result.metadata.contextUsage);
```

A tool without a native flag for a launch option throws before it starts; `getLaunchCapabilities(tools.codex)` reports what a tool supports. `attachments` works for Codex (`--image`) and OpenCode (`--file`). `interrupt()` ends the running turn for Claude and Qwen; `endInput()` closes stdin. `metadata.usageWindows` comes from Claude `rate_limit_event` messages and Codex `rate_limits`; `metadata.contextUsage` reports the last and peak context fill against the model's window. For Codex, `stop()` reads both from the thread's rollout file. See [launch options](../docs/common-concepts.md#launch-options) and the [upcomputer case study](../docs/case-studies/issue-57/README.md).

### Tool overrides

`toolOverrides` replaces a failing or missing part of a tool for one run: `buildCommand`, `parseOutput`, `extractSessionId`, `extractUsage`, `detectErrors` or a `supports*` capability flag. With a `buildCommand` it also drives a CLI that is not registered. `resolveToolConfig({ toolName, toolOverrides })` returns the merged configuration.

```javascript
import { agent, escapeArg, tools } from 'agent-commander';

const controller = agent({
  tool: 'claude',
  workingDirectory: '/tmp/project',
  prompt: 'Describe the screenshot',
  attachments: ['shot.png'],
  toolOverrides: {
    supportsAttachments: true,
    buildCommand: ({ attachments, ...options }) =>
      `${tools.claude.buildCommand(options)} --image ${attachments.map(escapeArg).join(' ')}`,
  },
});
```

See [tool overrides](../docs/common-concepts.md#tool-overrides).

### Real TUI capture

Use `captureAgentTui()` when a test must exercise the same interactive terminal
interface a person sees. It supports `claude`, `codex`, `opencode`, `agent`,
`gemini`, and `qwen` without switching them to their JSON/headless modes:

```javascript
import { captureAgentTui } from 'agent-commander';

const capture = await captureAgentTui({
  tool: 'codex',
  workingDirectory: '/tmp/project',
  prompt: 'Inspect the failing test',
  promptAfter: 'What do you want to work on?',
  startupInteractions: [
    { after: 'Do you trust the contents of this directory?', key: 'ENTER' },
  ],
  // Defaults to an 80×30 terminal whose rendered content is 4:3.
  aspectRatio: 4 / 3,
  interactions: [
    { after: 'Choose an option', key: 'DOWN' },
    { after: 'Second option', key: 'ENTER' },
    { after: 'Working', resize: { cols: 120, rows: 40 } },
  ],
  stopMarker: 'Finished',
  artifactDirectory: 'artifacts/codex',
  artifactOptions: {
    borderRadius: 0,
    cellWidth: 9,
    cellHeight: 18,
    fontSize: 14,
    padding: 12,
    background: '#111827',
    foreground: '#e5e7eb',
  },
  artifacts: ['svg', 'gif', 'cast', 'frames', 'transcript'],
});

console.log(capture.transcript);
console.log(capture.events); // normalized message and tool_call events
```

The result includes command-stream's unrolled transcript, settled frames, raw
asciicast event stream, and normalized semantic events. The artifact directory
contains `transcript.txt`, `frames.json`, `session.cast`, `snapshot.svg`, and
the self-contained animated `recording.svg`, plus `recording.gif` for consumers
that cannot animate SVG. Use `artifacts` to select bundle formats and
`artifactOptions` to customize renderer geometry and theme. Explicit `cols` and
`rows` override the default geometry. `frameMode: 'writes'` records a frame
after every PTY write instead of after each settle, and `recording: false`
keeps only the latest frame and the last 1 MB of output for long sessions
(command-stream 2.4.0). Partial artifacts are also written when the terminal
command times out.

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
    // `null` unsets an inherited variable
    extraEnv: { CODEX_HOME: '/tmp/codex-home', OPENAI_API_KEY: null },
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
- Per-command approval (ask mode) with a normalized `permission_request`/`permission_response` relay for tools with a drivable native handshake
- Launch options, live input, usage windows, context usage and the tool version probe
- Per-run tool overrides for the command builder, output parser, session ID and usage extractors, and capability flags

See [shared concepts](../docs/common-concepts.md) for behavior that should stay aligned across both packages, including the [per-command approval parity table](../docs/common-concepts.md#per-command-approval-ask-mode).

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
