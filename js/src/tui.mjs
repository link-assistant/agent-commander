import { captureTerminal } from 'command-stream';

import { getTool, isToolSupported } from './tools/index.mjs';
import { normalizeExtraArgs, normalizeExtraEnv } from './tools/shell.mjs';

const READ_ONLY_OPENCODE_PERMISSION =
  '{"edit":"deny","bash":"deny","task":"deny"}';

const mappedModel = (tool, model) =>
  model && tool.mapModelToId ? tool.mapModelToId({ model }) : model;

const safetyArgs = ({ readOnly, approveEach, skipDefaultSafetyFlags }) => {
  if (readOnly) {
    return ['--sandbox', 'read-only', '--ask-for-approval', 'never'];
  }
  if (approveEach) {
    return ['--ask-for-approval', 'on-request'];
  }
  return skipDefaultSafetyFlags
    ? []
    : ['--dangerously-bypass-approvals-and-sandbox'];
};

const claudeArgs = (options, tool) => {
  const args = [];
  if (options.readOnly) {
    args.push('--permission-mode', 'plan');
  } else if (options.approveEach) {
    args.push('--permission-mode', 'default');
  } else if (!options.skipDefaultSafetyFlags) {
    args.push('--dangerously-skip-permissions');
  }
  if (options.model) {
    args.push('--model', mappedModel(tool, options.model));
  }
  if (options.systemPrompt) {
    args.push('--append-system-prompt', options.systemPrompt);
  }
  if (options.resume) {
    args.push('--resume', options.resume);
  }
  args.push('--ax-screen-reader');
  return args;
};

const codexArgs = (options, tool) => {
  const args = safetyArgs(options);
  if (options.model) {
    args.unshift('--model', mappedModel(tool, options.model));
  }
  args.push('--no-alt-screen');
  if (options.resume) {
    args.push('resume', options.resume);
  }
  return args;
};

const opencodeArgs = (options, tool) => {
  const args = ['--mini', '--no-replay'];
  if (options.model) {
    args.push('--model', mappedModel(tool, options.model));
  }
  if (options.resume) {
    args.push('--session', options.resume);
  }
  if (!options.readOnly && !options.skipDefaultSafetyFlags) {
    args.push('--auto');
  }
  return args;
};

const agentArgs = (options, tool) => {
  const args = [];
  if (options.model) {
    args.push('--model', mappedModel(tool, options.model));
  }
  if (options.readOnly) {
    args.push('--permission-mode', 'readonly');
  } else if (options.planOnly) {
    args.push('--permission-mode', 'plan');
  } else if (options.approveEach) {
    args.push('--permission-mode', 'ask');
  }
  if (options.resume) {
    args.push('--resume', options.resume);
  }
  return args;
};

const geminiArgs = (options, tool) => {
  const args = [];
  if (options.model) {
    args.push('--model', mappedModel(tool, options.model));
  }
  if (options.readOnly) {
    args.push('--approval-mode', 'plan');
  } else if (!options.skipDefaultSafetyFlags) {
    args.push('--yolo');
  }
  return args;
};

const qwenArgs = (options, tool) => {
  const args = [];
  if (options.model) {
    args.push('--model', mappedModel(tool, options.model));
  }
  if (options.readOnly) {
    args.push('--approval-mode', 'plan');
  } else if (!options.skipDefaultSafetyFlags) {
    args.push('--yolo');
  }
  if (options.resume) {
    args.push('--resume', options.resume);
  }
  return args;
};

const ARG_BUILDERS = {
  claude: claudeArgs,
  codex: codexArgs,
  opencode: opencodeArgs,
  agent: agentArgs,
  gemini: geminiArgs,
  qwen: qwenArgs,
};

const launchEnvironment = ({ extraEnv, tool, readOnly }) => {
  const entries = normalizeExtraEnv(extraEnv);
  if (tool === 'opencode' && readOnly) {
    entries.push(['OPENCODE_PERMISSION', READ_ONLY_OPENCODE_PERMISSION]);
  }
  return { ...process.env, ...Object.fromEntries(entries) };
};

/**
 * Build an argv-based interactive launch without a shell or headless flags.
 */
export const buildAgentTuiLaunch = (options) => {
  const {
    tool: toolName,
    workingDirectory,
    executable,
    prefixArgs = [],
    extraArgs = [],
  } = options;
  if (!isToolSupported({ toolName })) {
    throw new Error(`Unsupported TUI tool: ${toolName}`);
  }
  if (!workingDirectory) {
    throw new Error('workingDirectory is required');
  }

  const tool = getTool({ toolName });
  const args = ARG_BUILDERS[toolName](options, tool);
  return {
    file: executable ?? tool.executable,
    args: [
      ...normalizeExtraArgs(prefixArgs),
      ...args,
      ...normalizeExtraArgs(extraArgs),
    ],
    cwd: workingDirectory,
    env: launchEnvironment({
      extraEnv: options.extraEnv,
      tool: toolName,
      readOnly: options.readOnly,
    }),
  };
};

const messageEvent = (line) => {
  const match = line.match(/^(?:[│┃>›❯•*]\s*)?(user|assistant):\s*(.*)$/i);
  if (!match) {
    return undefined;
  }
  return {
    type: 'message',
    role: match[1].toLowerCase(),
    content: match[2],
  };
};

const toolCallEvent = (line) => {
  const match = line.match(
    /^(?:[│┃>›❯•*]\s*)?tool[_ ]call:\s*([A-Za-z0-9_.-]+)(?:\s+(.*))?$/i
  );
  if (!match) {
    return undefined;
  }
  return {
    type: 'tool_call',
    name: match[1],
    input: match[2] ?? '',
  };
};

/**
 * Extract a stable cross-client message/tool-call stream from TUI text.
 */
export const normalizeTuiTranscript = (transcript) => {
  const events = [];
  for (const rawLine of transcript.split('\n')) {
    const line = rawLine.trim();
    const event = messageEvent(line) ?? toolCallEvent(line);
    if (event) {
      events.push(event);
    }
  }
  return events;
};

/**
 * Capture and drive an agent's real interactive terminal interface.
 */
export const captureAgentTui = async (options) => {
  const {
    tool,
    prompt,
    systemPrompt,
    promptAfter,
    promptKey = 'ENTER',
    interactions = [],
    cols,
    rows,
    settleMilliseconds,
    stopMarker,
    stopMarkerGraceMilliseconds,
    timeoutMilliseconds,
    artifactDirectory,
    onTrace,
  } = options;
  const launch = buildAgentTuiLaunch(options);
  const combinedPrompt =
    systemPrompt && tool !== 'claude'
      ? `${systemPrompt}\n\n${prompt ?? ''}`
      : prompt;
  const promptInteraction = combinedPrompt
    ? [{ after: promptAfter, text: combinedPrompt, key: promptKey }]
    : [];
  const capture = await captureTerminal({
    ...launch,
    cols,
    rows,
    settleMilliseconds,
    interactions: [...promptInteraction, ...interactions],
    stopMarker,
    stopMarkerGraceMilliseconds,
    timeoutMilliseconds,
    artifactDirectory,
    onTrace,
  });
  return {
    ...capture,
    tool,
    events: normalizeTuiTranscript(capture.transcript),
  };
};
