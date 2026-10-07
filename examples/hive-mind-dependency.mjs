#!/usr/bin/env node
// Run with: node examples/hive-mind-dependency.mjs claude --fixture
// Omit --fixture to invoke your installed, authenticated native CLI.
import { fileURLToPath } from "node:url";
import { agent, getTool, listTools } from "../js/src/index.mjs";

const tool = process.argv[2] || "claude";
if (!listTools().includes(tool)) {
  throw new Error(`Choose one of: ${listTools().join(", ")}`);
}
const offline = process.argv.includes("--fixture");
const controller = agent({
  tool,
  workingDirectory: process.cwd(),
  prompt: "Inspect this project and return a short plan.",
  systemPrompt: "Keep the plan concise.",
  model: getTool({ toolName: tool }).defaultModel,
  json: tool !== "agent", // Agent already emits native NDJSON.
  readOnly: true,
  toolOptions: offline
    ? {
        executable: fileURLToPath(
          new URL("../js/test/fixtures/fake-native-tool.mjs", import.meta.url),
        ),
        extraArgs: ["--fixture", tool],
      }
    : {}, // Put caller-resolved config, reasoning flags and env here.
});

// attached:false prevents duplicate console output when a consumer also
// forwards chunks through onOutput. Raw native messages stay available.
let messageCount = 0;
await controller.start({
  attached: false,
  onMessage: () => {
    messageCount++;
  },
});
const result = await controller.stop(); // Wait and collect; cancel() interrupts.
console.log(
  JSON.stringify(
    {
      tool,
      messageCount,
      exitCode: result.exitCode,
      sessionId: result.metadata.sessionId,
      success: result.metadata.success,
      summary: result.metadata.resultSummary,
      usage: result.metadata.streamTokenUsage,
      error: result.metadata.errorMessage,
    },
    null,
    2,
  ),
);
process.exitCode = result.metadata.success ? 0 : 1;
