const LANGUAGE_CONFIG = {
  javascript: {
    displayName: "JavaScript",
    packageLabel: "npm",
    tagPrefix: "js_",
    releasePrefix: "[JavaScript]",
    badgeColor: "cb3837",
    packageUrl: ({ packageName, version }) =>
      `https://www.npmjs.com/package/${packageName}/v/${version}`,
  },
  rust: {
    displayName: "Rust",
    packageLabel: "crates.io",
    tagPrefix: "rust_",
    releasePrefix: "[Rust]",
    badgeColor: "dea584",
    packageUrl: ({ packageName, version, cratesIoUrl }) => {
      const baseUrl = cratesIoUrl || `https://crates.io/crates/${packageName}`;
      return `${baseUrl.replace(/\/$/, "")}/${version}`;
    },
  },
};

/**
 * Normalize release input to a bare semantic version.
 * @param {string} version
 * @returns {string}
 */
export function normalizeReleaseVersion(version) {
  const normalized = String(version || "")
    .trim()
    .replace(/^(js_|rust_)/, "")
    .replace(/^v/, "");

  if (!normalized) {
    throw new Error("release version is required");
  }

  return normalized;
}

function encodeBadgeSegment(value) {
  return encodeURIComponent(value).replace(/-/g, "--");
}

/**
 * Build a static Shields.io badge for a concrete package version.
 * @param {Object} options
 * @param {string} options.label
 * @param {string} options.version
 * @param {string} options.color
 * @returns {string}
 */
export function buildVersionBadgeUrl({ label, version, color }) {
  return `https://img.shields.io/badge/${encodeBadgeSegment(label)}-${encodeBadgeSegment(`v${version}`)}-${color}.svg?style=flat`;
}

/**
 * Build consistent GitHub Release metadata for language-specific packages.
 * @param {Object} options
 * @param {'javascript'|'rust'} options.language
 * @param {string} options.version
 * @param {string} [options.releaseNotes]
 * @param {string} [options.packageName]
 * @param {string} [options.cratesIoUrl]
 * @returns {{tagName: string, name: string, body: string}}
 */
export function buildReleaseMetadata({
  language,
  version,
  releaseNotes = "",
  packageName = "agent-commander",
  cratesIoUrl,
}) {
  const config = LANGUAGE_CONFIG[language];
  if (!config) {
    throw new Error(`unsupported release language: ${language}`);
  }

  const normalizedVersion = normalizeReleaseVersion(version);
  const packageUrl = config.packageUrl({
    packageName,
    version: normalizedVersion,
    cratesIoUrl,
  });
  const badgeUrl = buildVersionBadgeUrl({
    label: config.packageLabel,
    version: normalizedVersion,
    color: config.badgeColor,
  });
  const badge = `[![${config.packageLabel} v${normalizedVersion}](${badgeUrl})](${packageUrl})`;
  const notes =
    releaseNotes.trim() || `${config.displayName} release ${normalizedVersion}`;

  return {
    tagName: `${config.tagPrefix}${normalizedVersion}`,
    name: `${config.releasePrefix} v${normalizedVersion}`,
    body: `${badge}\n\nPackage: ${config.packageLabel} \`${packageName}@${normalizedVersion}\`\n\n${notes}`,
  };
}
