#!/usr/bin/env node
// Demonstrates the uniform per-command approval ("ask" mode) relay.
//
// A consumer running an agent with `--approve-each` receives one normalized
// `permission_request` event per command the agent wants to run, decides
// `once` | `always` | `reject`, and the matching native response is forwarded
// back to the CLI's stdin. This script simulates that loop without spawning a
// real agent by feeding native frames straight into a PermissionRelay.
//
// Run: node examples/permission-relay.mjs

import {
  PermissionRelay,
  normalizePermissionRequest,
  PERMISSION_PARITY,
  supportsAsk,
} from "../js/src/index.mjs";

// A trivial approval policy: allow reads, ask-once for builds, reject deletes.
function decide(request) {
  const command = request.command ?? "";
  if (/\brm\b|\bdelete\b/.test(command)) return "reject";
  if (/\bnpm (run )?build\b|\bcargo build\b/.test(command)) return "always";
  return "once";
}

for (const tool of ["agent", "claude"]) {
  console.log(`\n=== ${tool} (supportsAsk=${supportsAsk({ tool })}) ===`);

  const sentToCli = [];
  const relay = new PermissionRelay({
    tool,
    onRequest: (req) => {
      const decision = decide(req);
      console.log(`  request: ${req.command ?? req.toolName} -> ${decision}`);
      return decision;
    },
    write: (line) => sentToCli.push(line),
  });

  // Native frames as each backend emits them.
  const frames =
    tool === "agent"
      ? [
          {
            type: "permission_request",
            permissionID: "p1",
            tool: "bash",
            metadata: { command: "npm run build" },
          },
          {
            type: "permission_request",
            permissionID: "p2",
            tool: "bash",
            metadata: { command: "rm -rf dist" },
          },
        ]
      : [
          {
            type: "control_request",
            request_id: "r1",
            request: {
              subtype: "can_use_tool",
              tool_name: "Bash",
              input: { command: "cargo build" },
            },
          },
          {
            type: "control_request",
            request_id: "r2",
            request: {
              subtype: "can_use_tool",
              tool_name: "Bash",
              input: { command: "rm -rf target" },
            },
          },
        ];

  for (const message of frames) {
    await relay.handleMessage({ message });
  }

  console.log("  forwarded to native CLI stdin:");
  for (const line of sentToCli) console.log(`    ${line}`);
}

// The same normalization powers the docs parity table.
console.log("\n=== parity (relayable only) ===");
for (const row of PERMISSION_PARITY.filter((r) => r.relay)) {
  console.log(`  ${row.tool}: scope=${row.scope}  via ${row.nativeMechanism}`);
}

// Spot-check that an unrelated message is ignored (returns null).
const ignored = normalizePermissionRequest({
  tool: "agent",
  message: { type: "step_finish" },
});
console.log(`\nnon-permission message normalized to: ${ignored}`);
