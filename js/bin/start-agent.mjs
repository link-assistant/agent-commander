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
