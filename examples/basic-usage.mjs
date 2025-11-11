/**
 * Basic usage example for agent-commander
 */

import { agent } from '../src/index.mjs';

async function basicExample() {
  console.log('=== Basic Agent Usage Example ===\n');

  // Example 1: Dry run (no isolation)
  console.log('1. Dry run with no isolation:');
  const agent1 = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Hello, World!',
  });

  await agent1.start({ dryRun: true });
  console.log('(Command printed above)\n');

  // Example 2: Actual execution with no isolation
  console.log('2. Actual execution with no isolation:');
  const agent2 = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Hello from agent!',
  });

  await agent2.start();
  const result2 = await agent2.stop();
  console.log('Exit code:', result2.exitCode);
  console.log('Output (plain):', result2.output.plain.trim());
  console.log('Output (parsed):', result2.output.parsed);
  console.log();

  // Example 3: Dry run with screen isolation
  console.log('3. Dry run with screen isolation (detached):');
  const agent3 = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Running in screen',
    isolation: 'screen',
    screenName: 'my-agent-session',
  });

  await agent3.start({ dryRun: true, detached: true });
  console.log('(Command printed above)\n');

  // Example 4: Dry run with docker isolation
  console.log('4. Dry run with docker isolation:');
  const agent4 = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Running in docker',
    isolation: 'docker',
    containerName: 'my-agent-container',
  });

  await agent4.start({ dryRun: true, detached: true });
  console.log('(Command printed above)\n');

  // Example 5: Stop commands (dry run)
  console.log('5. Stop command for screen (dry run):');
  const result5 = await agent3.stop({ dryRun: true });
  console.log('Exit code:', result5.exitCode);
  console.log();

  console.log('6. Stop command for docker (dry run):');
  const result6 = await agent4.stop({ dryRun: true });
  console.log('Exit code:', result6.exitCode);
  console.log();

  console.log('=== Examples completed ===');
}

// Run examples
basicExample().catch(console.error);
