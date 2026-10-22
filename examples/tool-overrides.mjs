#!/usr/bin/env node
// Run with: node examples/tool-overrides.mjs
// Drives a CLI that agent-commander does not know ("my-agent", here a
// printf stand-in) through per-run tool overrides (issue #57).
import { agent } from "../js/src/index.mjs";

const events = [
  { type: "init", session: "sess-1" },
  { type: "text", text: "All tests pass." },
  { type: "done", tokens: 42 },
];
const lines = (output) =>
  output
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));

const controller = agent({
  tool: "my-agent",
  workingDirectory: process.cwd(),
  prompt: "Fix the tests",
  toolOverrides: {
    // A real integration returns e.g. `my-agent --json ${escaped prompt}`.
    buildCommand: () =>
      `printf '%s\\n' ${events.map((e) => `'${JSON.stringify(e)}'`).join(" ")}`,
    parseOutput: ({ output }) => lines(output),
    extractSessionId: ({ output }) => lines(output)[0].session,
    extractUsage: ({ output }) => ({
      totalTokens: lines(output).at(-1).tokens,
    }),
  },
});

await controller.start({ attached: false });
const result = await controller.stop();
console.log(
  JSON.stringify(
    {
      exitCode: result.exitCode,
      sessionId: result.sessionId,
      usage: result.usage,
      parsed: result.output.parsed,
    },
    null,
    2,
  ),
);
