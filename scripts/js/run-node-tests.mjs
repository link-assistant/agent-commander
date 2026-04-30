#!/usr/bin/env node

import { spawnSync } from "child_process";
import { existsSync, readdirSync } from "fs";
import { join } from "path";

const TEST_DIR = "test";
const TEST_NAME_PATTERN = process.env.NODE_TEST_PATTERN || ".*";

const testDirPath = join(process.cwd(), TEST_DIR);

if (!existsSync(testDirPath)) {
  console.error(`Test directory not found: ${testDirPath}`);
  process.exit(1);
}

const testFiles = readdirSync(testDirPath)
  .filter((fileName) => fileName.endsWith(".test.mjs"))
  .sort()
  .map((fileName) => join(TEST_DIR, fileName));

if (testFiles.length === 0) {
  console.error(`No .test.mjs files found in ${testDirPath}`);
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--test", `--test-name-pattern=${TEST_NAME_PATTERN}`, ...testFiles],
  {
    stdio: "inherit",
  },
);

if (result.error) {
  console.error(`Failed to run Node tests: ${result.error.message}`);
  process.exit(1);
}

if (result.signal) {
  console.error(`Node test runner exited with signal ${result.signal}`);
  process.exit(1);
}

process.exit(result.status ?? 1);
