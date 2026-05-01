const DEFAULT_TAG_PREFIX = "rust_";

/**
 * Parse a semantic version into comparable numeric parts.
 * @param {string|{major: number, minor: number, patch: number}} version
 * @returns {{major: number, minor: number, patch: number}|null}
 */
export function parseSemver(version) {
  if (version && typeof version === "object") {
    const { major, minor, patch } = version;
    if (
      Number.isInteger(major) &&
      Number.isInteger(minor) &&
      Number.isInteger(patch)
    ) {
      return { major, minor, patch };
    }
    return null;
  }

  const match = String(version || "")
    .trim()
    .replace(/^(rust_|v)/, "")
    .match(/^(\d+)\.(\d+)\.(\d+)(?:-.+)?$/);

  if (!match) {
    return null;
  }

  return {
    major: Number.parseInt(match[1], 10),
    minor: Number.parseInt(match[2], 10),
    patch: Number.parseInt(match[3], 10),
  };
}

/**
 * Format semantic version parts.
 * @param {{major: number, minor: number, patch: number}} version
 * @returns {string}
 */
export function formatSemver(version) {
  return `${version.major}.${version.minor}.${version.patch}`;
}

/**
 * Compare two semantic versions.
 * @param {string|{major: number, minor: number, patch: number}} left
 * @param {string|{major: number, minor: number, patch: number}} right
 * @returns {-1|0|1}
 */
export function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);

  if (!parsedLeft || !parsedRight) {
    throw new Error(`invalid semantic version comparison: ${left}, ${right}`);
  }

  for (const key of ["major", "minor", "patch"]) {
    if (parsedLeft[key] < parsedRight[key]) {
      return -1;
    }
    if (parsedLeft[key] > parsedRight[key]) {
      return 1;
    }
  }

  return 0;
}

/**
 * Calculate a semantic version bump.
 * @param {string|{major: number, minor: number, patch: number}} current
 * @param {'major'|'minor'|'patch'} bumpType
 * @returns {string}
 */
export function calculateNewVersion(current, bumpType) {
  const parsed = parseSemver(current);
  if (!parsed) {
    throw new Error(`invalid current version: ${current}`);
  }

  switch (bumpType) {
    case "major":
      return `${parsed.major + 1}.0.0`;
    case "minor":
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case "patch":
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      throw new Error(`invalid bump type: ${bumpType}`);
  }
}

/**
 * Extract non-yanked version numbers from a crates.io crate response.
 * @param {{versions?: Array<{num?: string, yanked?: boolean}>}} payload
 * @returns {string[]}
 */
export function extractCratesVersions(payload) {
  return (payload?.versions || [])
    .filter((version) => !version.yanked && typeof version.num === "string")
    .map((version) => version.num);
}

/**
 * Find the maximum non-prerelease semantic version in a version list.
 * @param {string[]} versions
 * @returns {string}
 */
export function maxPublishedVersion(versions) {
  let maxVersion = "";

  for (const version of versions) {
    if (!parseSemver(version)) {
      continue;
    }
    if (!maxVersion || compareSemver(version, maxVersion) > 0) {
      maxVersion = version;
    }
  }

  return maxVersion;
}

/**
 * Check if a version has already been published in a crates.io version list.
 * @param {string} version
 * @param {string[]} publishedVersions
 * @returns {boolean}
 */
export function isVersionPublished(version, publishedVersions) {
  return publishedVersions.some(
    (publishedVersion) =>
      parseSemver(publishedVersion) &&
      compareSemver(version, publishedVersion) === 0,
  );
}

function hasReleaseTag(version, existingTags, tagPrefix) {
  return existingTags.includes(`${tagPrefix}${version}`);
}

function bumpPatch(version) {
  const parsed = parseSemver(version);
  if (!parsed) {
    throw new Error(`invalid semantic version: ${version}`);
  }
  return formatSemver({ ...parsed, patch: parsed.patch + 1 });
}

/**
 * Select a Rust release version that is greater than crates.io and unused by
 * existing release tags.
 * @param {Object} options
 * @param {string|{major: number, minor: number, patch: number}} options.currentVersion
 * @param {'major'|'minor'|'patch'} options.bumpType
 * @param {string[]} [options.publishedVersions]
 * @param {string[]} [options.existingTags]
 * @param {string} [options.tagPrefix]
 * @returns {string}
 */
export function selectRustReleaseVersion({
  currentVersion,
  bumpType,
  publishedVersions = [],
  existingTags = [],
  tagPrefix = DEFAULT_TAG_PREFIX,
}) {
  let candidate = calculateNewVersion(currentVersion, bumpType);
  const maxPublished = maxPublishedVersion(publishedVersions);

  if (maxPublished && compareSemver(candidate, maxPublished) <= 0) {
    candidate = bumpPatch(maxPublished);
  }

  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (
      !hasReleaseTag(candidate, existingTags, tagPrefix) &&
      !isVersionPublished(candidate, publishedVersions)
    ) {
      return candidate;
    }
    candidate = bumpPatch(candidate);
  }

  throw new Error("could not find an unpublished Rust release version");
}

/**
 * Fetch published non-yanked versions from crates.io.
 * @param {string} crateName
 * @param {{fetchImpl?: typeof fetch}} [options]
 * @returns {Promise<string[]>}
 */
export async function fetchCratesVersions(
  crateName,
  { fetchImpl = fetch } = {},
) {
  const response = await fetchImpl(
    `https://crates.io/api/v1/crates/${encodeURIComponent(crateName)}`,
    {
      headers: {
        "User-Agent": "agent-commander-release-check",
      },
    },
  );

  if (response.status === 404) {
    return [];
  }

  if (!response.ok) {
    throw new Error(
      `crates.io returned HTTP ${response.status} for ${crateName}`,
    );
  }

  return extractCratesVersions(await response.json());
}

/**
 * Parse package name and version from Cargo.toml content.
 * @param {string} cargoToml
 * @returns {{name: string, version: string}}
 */
export function parseCargoPackageInfo(cargoToml) {
  const name = cargoToml.match(/^name\s*=\s*"([^"]+)"/m)?.[1];
  const version = cargoToml.match(/^version\s*=\s*"([^"]+)"/m)?.[1];

  if (!name || !version) {
    throw new Error("could not parse package name and version from Cargo.toml");
  }

  return { name, version };
}
