#!/usr/bin/env node

/**
 * Check whether the Rust package needs a release.
 *
 * crates.io is the source of truth here: a git tag or GitHub Release can exist
 * even when the crate was never published.
 */

import { appendFileSync, readFileSync } from "fs";
import {
  fetchCratesVersions,
  isVersionPublished,
  maxPublishedVersion,
  parseCargoPackageInfo,
} from "./release-registry.mjs";

/**
 * Append to GitHub Actions output file.
 * @param {string} key
 * @param {string} value
 */
function setOutput(key, value) {
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    appendFileSync(outputFile, `${key}=${value}\n`);
  }
  console.log(`Output: ${key}=${value}`);
}

async function main() {
  const { name, version } = parseCargoPackageInfo(
    readFileSync("Cargo.toml", "utf-8"),
  );
  const hasFragments = process.env.HAS_FRAGMENTS === "true";
  const publishedVersions = await fetchCratesVersions(name);
  const maxPublished = maxPublishedVersion(publishedVersions);

  setOutput("max_published_version", maxPublished);

  if (!hasFragments) {
    const isPublished = isVersionPublished(version, publishedVersions);
    console.log(
      `Crate: ${name}, Version: ${version}, Published on crates.io: ${isPublished}`,
    );

    if (isPublished) {
      console.log(
        `No changelog fragments and ${version} is already published on crates.io`,
      );
      setOutput("should_release", "false");
      return;
    }

    console.log(
      `No changelog fragments but ${version} is not published to crates.io`,
    );
    setOutput("should_release", "true");
    setOutput("skip_bump", "true");
    return;
  }

  console.log("Found changelog fragments, proceeding with release");
  setOutput("should_release", "true");
  setOutput("skip_bump", "false");
}

main().catch((error) => {
  console.error("Error:", error.message);
  process.exit(1);
});
