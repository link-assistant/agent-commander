#!/usr/bin/env bun

/**
 * Create GitHub Release from CHANGELOG.md
 * Usage: node scripts/create-github-release.mjs --release-version <version> --repository <repository>
 *   release-version: Version number (e.g., 1.0.0)
 *   repository: GitHub repository (e.g., owner/repo)
 *
 * Uses link-foundation libraries:
 * - use-m: Dynamic package loading without package.json dependencies
 * - command-stream: Modern shell command execution with streaming support
 * - lino-arguments: Unified configuration from CLI args, env vars, and .lenv files
 */

import { readFileSync } from "fs";
import { buildReleaseMetadata } from "../shared/release-metadata.mjs";

// Load use-m dynamically
const { use } = eval(
  await (await fetch("https://unpkg.com/use-m/use.js")).text(),
);

// Import link-foundation libraries
const { $ } = await use("command-stream");
const { makeConfig } = await use("lino-arguments");

// Parse CLI arguments using lino-arguments
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
      }),
});

const { releaseVersion: version, repository } = config;

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

try {
  // Read CHANGELOG.md
  const changelog = readFileSync("./CHANGELOG.md", "utf8");

  // Extract changelog entry for this version
  // Read from CHANGELOG.md between this version header and the next version header
  const versionHeaderRegex = new RegExp(`## ${version}[\\s\\S]*?(?=## \\d|$)`);
  const match = changelog.match(versionHeaderRegex);

  let releaseNotes = "";
  if (match) {
    // Remove the version header itself and trim
    releaseNotes = match[0].replace(`## ${version}`, "").trim();
  }

  if (!releaseNotes) {
    releaseNotes = `JavaScript release ${version}`;
  }

  const release = buildReleaseMetadata({
    language: "javascript",
    version,
    releaseNotes,
  });

  console.log(`Creating GitHub release for ${release.tagName}...`);

  // Create release using GitHub API with JSON input
  // This avoids shell escaping issues that occur when passing text via command-line arguments
  // (Previously caused apostrophes like "didn't" to appear as "didn'''" in releases)
  const payload = JSON.stringify({
    tag_name: release.tagName,
    name: release.name,
    body: release.body,
    make_latest: release.makeLatest ? "true" : "false",
  });

  const result =
    await $`gh api repos/${repository}/releases -X POST --input -`.run({
      stdin: payload,
      capture: true,
    });

  if (result.code !== 0) {
    const output = `${result.stdout || ""}${result.stderr || ""}`;
    if (
      output.includes("already exists") ||
      output.includes("already_exists")
    ) {
      console.log(`GitHub release ${release.tagName} already exists, updating`);
      await updateExistingRelease({ repository, release, payload });
    } else {
      throw new Error(output || `gh api exited with code ${result.code}`);
    }
  } else {
    console.log(`\u2705 Created GitHub release: ${release.tagName}`);
  }
} catch (error) {
  console.error("Error creating release:", error.message);
  process.exit(1);
}
