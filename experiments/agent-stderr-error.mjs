#!/usr/bin/env node
// Run with: node experiments/agent-stderr-error.mjs [/path/to/agent]
// @link-assistant/agent writes events to stdout and only fatal errors to
// stderr, pretty-printed unless --compact-json (src/cli/output.ts
// outputError). This prints what agent-commander reports for such a run.
// Without an argument it uses a fake agent that fails like agent 0.26.15
// does for an unknown model.
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agent } from "../js/src/index.mjs";

let executable = process.argv[2];
if (!executable) {
  executable = join(mkdtempSync(join(tmpdir(), "fake-agent-")), "agent");
  writeFileSync(
    executable,
    [
      "#!/bin/sh",
      "cat >/dev/null",
      `printf '{\\n  "type": "error",\\n  "errorType": "ProviderModelNotFoundError",\\n  "message": "Model kilo/foo not found"\\n}\\n' >&2`,
      "exit 1",
      "",
    ].join("\n"),
  );
  chmodSync(executable, 0o755);
}

const controller = agent({
  tool: "agent",
  workingDirectory: process.cwd(),
  prompt: "hi",
  toolOptions: { executable },
});
await controller.start({ attached: false });
const { metadata } = await controller.stop();
console.log(
  JSON.stringify(
    {
      success: metadata.success,
      errorType: metadata.errorType,
      errorMessage: metadata.errorMessage,
    },
    null,
    2,
  ),
);
