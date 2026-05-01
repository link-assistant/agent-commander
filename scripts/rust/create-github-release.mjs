#!/usr/bin/env node

/**
 * Create GitHub Release from CHANGELOG.md
 * Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync, existsSync } from "fs";
import { buildReleaseMetadata } from "../shared/release-metadata.mjs";

// Load use-m dynamically
const { use } = eval(
  await (await fetch("https://unpkg.com/use-m/use.js")).text(),
);

// Import link-foundation libraries
const { $ } = await use("command-stream");
const { makeConfig } = await use("lino-arguments");

// Parse CLI arguments
// Note: Using --release-version instead of --version to avoid conflict with yargs' built-in --version flag
const config = makeConfig({
  yargs: ({ yargs, getenv }) =>
    yargs
      .option("release-version", {
        type: "string",
        default: getenv("VERSION", ""),
        describe: "Version number (e.g., 1.0.0)",
      })
      .option("repository", {
        type: "string",
        default: getenv("REPOSITORY", ""),
        describe: "GitHub repository (e.g., owner/repo)",
      })
      .option("crates-io-url", {
        type: "string",
        default: getenv("CRATES_IO_URL", ""),
        describe: "Crates.io package URL",
      }),
});

const { releaseVersion: version, repository, cratesIoUrl } = config;

if (!version || !repository) {
  console.error("Error: Missing required arguments");
  console.error(
    "Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>",
  );
  process.exit(1);
}

/**
 * Update an existing release by tag name.
 * @param {Object} options
 * @param {string} options.repository
 * @param {{tagName: string}} options.release
 * @param {string} options.payload
 */
async function updateExistingRelease({ repository, release, payload }) {
  const existingResult =
    await $`gh api repos/${repository}/releases/tags/${release.tagName}`.run({
      capture: true,
    });

  if (existingResult.code !== 0) {
    throw new Error(
      existingResult.stderr ||
        existingResult.stdout ||
        `failed to read existing release ${release.tagName}`,
    );
  }

  const existingRelease = JSON.parse(existingResult.stdout);
  const updateResult =
    await $`gh api repos/${repository}/releases/${existingRelease.id} -X PATCH --input -`.run(
      {
        stdin: payload,
        capture: true,
      },
    );

  if (updateResult.code !== 0) {
    throw new Error(
      updateResult.stderr ||
        updateResult.stdout ||
        `failed to update existing release ${release.tagName}`,
    );
  }

  console.log(`Updated GitHub release: ${release.tagName}`);
}

/**
 * Extract changelog content for a specific version
 * @param {string} version
 * @returns {string}
 */
function getChangelogForVersion(version) {
  const changelogPath = "CHANGELOG.md";

  if (!existsSync(changelogPath)) {
    return `Rust release ${version}`;
  }

  const content = readFileSync(changelogPath, "utf-8");

  // Find the section for this version
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `## \\[${escapedVersion}\\].*?\\n([\\s\\S]*?)(?=\\n## \\[|$)`,
  );
  const match = content.match(pattern);

  if (match) {
    return match[1].trim();
  }

  return `Rust release ${version}`;
}

try {
  const releaseNotes = getChangelogForVersion(version);
  const release = buildReleaseMetadata({
    language: "rust",
    version,
    releaseNotes,
    cratesIoUrl,
  });

  console.log(`Creating GitHub release for ${release.tagName}...`);

  // Create release using GitHub API with JSON input
  // This avoids shell escaping issues
  const payload = JSON.stringify({
    tag_name: release.tagName,
    name: release.name,
    body: release.body,
    make_latest: release.makeLatest ? "true" : "false",
  });

  try {
    const result =
      await $`gh api repos/${repository}/releases -X POST --input -`.run({
        stdin: payload,
        capture: true,
      });

    if (result.code !== 0) {
      const output = `${result.stdout || ""}${result.stderr || ""}`;
      throw new Error(output || `gh api exited with code ${result.code}`);
    }

    console.log(`Created GitHub release: ${release.tagName}`);
  } catch (error) {
    const message = error.message || "";
    // Check if release already exists
    if (
      message.includes("already exists") ||
      message.includes("already_exists")
    ) {
      console.log(`Release ${release.tagName} already exists, updating`);
      await updateExistingRelease({ repository, release, payload });
    } else {
      throw error;
    }
  }
} catch (error) {
  console.error("Error creating release:", error.message);
  process.exit(1);
}
