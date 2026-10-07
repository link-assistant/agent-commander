#!/usr/bin/env node
import { URL } from 'node:url';
// A deterministic, credential-free CLI implementing the native stdout contract.
import { readFileSync } from 'node:fs';
const tool = process.argv[process.argv.indexOf('--fixture') + 1];
const fixtures = JSON.parse(
  readFileSync(new URL('./hive-mind-parity.json', import.meta.url))
);
const fixture = fixtures.usage.find((entry) => entry.tool === tool);
if (
  tool === 'claude' &&
  (!process.argv.includes('-p') || !process.argv.includes('--verbose'))
) {
  process.exit(2);
}
let prompt = '';
for await (const chunk of process.stdin) {
  prompt += chunk;
}
if (process.argv.includes('--pretty-json')) {
  console.log(
    JSON.stringify(
      {
        session_id: 'pretty-session',
        response: 'Done',
        stats: fixture.events.find((event) => event.stats).stats,
      },
      null,
      2
    )
  );
} else {
  console.log(
    JSON.stringify({
      type: 'fixture_input',
      prompt,
      cwd: process.cwd(),
      args: process.argv.slice(2),
    })
  );
  for (const event of fixture.events) {
    console.log(JSON.stringify(event));
  }
}
console.error(
  JSON.stringify({
    type: 'error',
    session_id: 'stderr-session',
    message: 'diagnostic only',
    usage: { input_tokens: 9999 },
  })
);
