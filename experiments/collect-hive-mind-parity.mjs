// Re-run against a local Hive Mind checkout; importing the leaf catalogue is offline.
import { writeFile, copyFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
const checkout = process.argv[2];
if (!checkout)
  throw new Error(
    "Usage: node experiments/collect-hive-mind-parity.mjs CHECKOUT",
  );
const catalog = await import(
  pathToFileURL(`${checkout}/src/models/catalog.mjs`)
);
const models = Object.fromEntries(
  ["claude", "codex", "agent", "opencode", "qwen", "gemini"].map((tool) => [
    tool,
    catalog[tool === "codex" ? "CODEX_MODEL_VARIANTS" : `${tool}Models`],
  ]),
);
const snapshot = {
  source: "link-assistant/hive-mind",
  sha: execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim(),
  models,
  defaults: catalog.defaultModels,
};
await writeFile(
  "docs/case-studies/issue-50/data/model-catalog.json",
  `${JSON.stringify(snapshot, null, 2)}\n`,
);
for (const file of [
  "agent-commander.lib.mjs",
  "models/catalog.mjs",
  "formal-ai-model.lib.mjs",
]) {
  await copyFile(
    `${checkout}/src/${file}`,
    `docs/case-studies/issue-50/data/${file.replaceAll("/", "-")}.txt`,
  );
}
