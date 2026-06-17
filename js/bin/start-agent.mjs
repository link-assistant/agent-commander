#!/usr/bin/env node

/**
 * start-agent CLI command
 * Start an agent with specified configuration
 */

import { agent } from '../src/index.mjs';
import {
  parseStartAgentArgs,
  showStartAgentHelp,
  validateStartAgentOptions,
} from '../src/cli-parser.mjs';
import {
  parseNdjsonLine,
  stringifyNdjsonLine,
} from '../src/streaming/ndjson.mjs';

/**
 * Build a per-command approval consumer bridge over the process's own stdio.
 *
 * The agent controller normalizes each native permission request and hands it
 * to `onPermissionRequest`. Here we emit that normalized request to stdout as
 * an NDJSON line and wait for the consumer to reply on stdin with a matching
 * `{ "type": "permission_response", "id": <id>, "decision": "once|always|reject" }`
 * frame. The decision is resolved back to the controller, which forwards it to
 * the native CLI's stdin in the correct wire format.
 *
 * @returns {Function} async (normalizedRequest) => 'once' | 'always' | 'reject'
 */
function createStdioApprovalBridge() {
  const pending = new Map();
  let buffer = '';

  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const message = parseNdjsonLine({ line });
      if (
        message &&
        message.type === 'permission_response' &&
        message.id !== null &&
        message.id !== undefined &&
        pending.has(message.id)
      ) {
        const resolve = pending.get(message.id);
        pending.delete(message.id);
        resolve(message.decision);
      }
    }
  });

  return (request) =>
    new Promise((resolve) => {
      pending.set(request.id, resolve);
      // `raw` carries the unnormalized native frame; omit it from the relayed
      // event so the consumer sees a clean, tool-agnostic request.
      const { raw: _raw, ...relayed } = request;
      process.stdout.write(stringifyNdjsonLine({ value: relayed }));
    });
}

async function main() {
  const args = process.argv.slice(2);
  const options = parseStartAgentArgs(args);

  // Show help if requested
  if (options.help) {
    showStartAgentHelp();
    process.exit(0);
  }

  // Validate options
  const validation = validateStartAgentOptions(options);
  if (!validation.valid) {
    console.error('Error: Invalid options\n');
    validation.errors.forEach((error) => console.error(`  - ${error}`));
    console.error('\nRun "start-agent --help" for usage information.');
    process.exit(1);
  }

  try {
    // When per-command approval is requested, bridge the relay to this
    // process's stdio so an external consumer can approve/reject each command.
    const onPermissionRequest = options.approveEach
      ? createStdioApprovalBridge()
      : undefined;

    // Create agent controller
    const agentController = agent({
      tool: options.tool,
      workingDirectory: options.workingDirectory,
      prompt: options.prompt,
      promptFile: options.promptFile,
      systemPrompt: options.systemPrompt,
      model: options.model,
      resume: options.resume,
      readOnly: options.readOnly,
      planOnly: options.planOnly,
      approveEach: options.approveEach,
      onPermissionRequest,
      isolation: options.isolation,
      screenName: options.screenName,
      containerName: options.containerName,
      toolOptions: {
        appendSystemPrompt: options.appendSystemPrompt,
        fallbackModel: options.fallbackModel,
        verbose: options.verbose,
        replayUserMessages: options.replayUserMessages,
        sessionId: options.sessionId,
        forkSession: options.forkSession,
        executable: options.toolExecutable,
        extraArgs: options.toolArgs,
        extraEnv: options.toolEnv,
        skipDefaultSafetyFlags: options.skipDefaultSafetyFlags,
      },
    });

    // Start the agent
    await agentController.start({
      dryRun: options.dryRun,
      detached: options.detached,
      attached: options.attached,
    });

    // Exit with the agent's exit code
    if (!options.detached && !options.dryRun) {
      const result = await agentController.stop();
      process.exit(result.exitCode);
    }
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
