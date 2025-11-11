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

  const result1 = await agent1.start({ dryRun: true });
  console.log('Command:', result1.command);
  console.log();

  // Example 2: Dry run with screen isolation
  console.log('2. Dry run with screen isolation (detached):');
  const agent2 = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Running in screen',
    isolation: 'screen',
    screenName: 'my-agent-session',
  });

  const result2 = await agent2.start({ dryRun: true, detached: true });
  console.log('Command:', result2.command);
  console.log();

  // Example 3: Dry run with docker isolation
  console.log('3. Dry run with docker isolation:');
  const agent3 = agent({
    tool: 'echo',
    workingDirectory: '/tmp',
    prompt: 'Running in docker',
    isolation: 'docker',
    containerName: 'my-agent-container',
  });

  const result3 = await agent3.start({ dryRun: true, detached: true });
  console.log('Command:', result3.command);
  console.log();

  // Example 4: Stop commands (dry run)
  console.log('4. Stop command for screen (dry run):');
  const result4 = await agent2.stop({ dryRun: true });
  console.log('Command:', result4.command);
  console.log();

  console.log('5. Stop command for docker (dry run):');
  const result5 = await agent3.stop({ dryRun: true });
  console.log('Command:', result5.command);
  console.log();

  console.log('=== Examples completed ===');
}

// Run examples
basicExample().catch(console.error);
