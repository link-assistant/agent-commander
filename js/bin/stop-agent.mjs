#!/usr/bin/env node

/**
 * stop-agent CLI command
 * Stop a detached agent
 */

import { agent } from '../src/index.mjs';
import {
  parseStopAgentArgs,
  showStopAgentHelp,
  validateStopAgentOptions,
} from '../src/cli-parser.mjs';

async function main() {
  const args = process.argv.slice(2);
  const options = parseStopAgentArgs(args);

  // Show help if requested
  if (options.help) {
    showStopAgentHelp();
    process.exit(0);
  }

  // Validate options
  const validation = validateStopAgentOptions(options);
  if (!validation.valid) {
    console.error('Error: Invalid options\n');
    validation.errors.forEach((error) => console.error(`  - ${error}`));
    console.error('\nRun "stop-agent --help" for usage information.');
    process.exit(1);
  }

  try {
    // Create agent controller (minimal config needed for stop)
    const agentController = agent({
      tool: 'dummy', // Not used for stop
      workingDirectory: '/tmp', // Not used for stop
      isolation: options.isolation,
      screenName: options.screenName,
      containerName: options.containerName,
    });

    // Stop the agent
    const result = await agentController.stop({
      dryRun: options.dryRun,
    });

    console.log('Agent stopped successfully');
    process.exit(result.exitCode);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

main();
