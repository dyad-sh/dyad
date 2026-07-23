#!/usr/bin/env node

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const PROVENANCE_SCHEMA_VERSION = 1;
const RELEASE_WORKFLOW = ".github/workflows/release.yml";
const RELEASE_ARTIFACT_EXTENSIONS = new Set([
  ".AppImage",
  ".deb",
  ".exe",
  ".nupkg",
  ".rpm",
  ".zip",
]);

function isReleaseArtifact(filePath) {
  const basename = path.basename(filePath);
  return (
    basename === "RELEASES" ||
    RELEASE_ARTIFACT_EXTENSIONS.has(path.extname(basename))
  );
}

function listFilesRecursively(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFilesRecursively(entryPath) : [entryPath];
  });
}

function hashFile(filePath) {
  const hash = crypto.createHash("sha256");
  const fileDescriptor = fs.openSync(filePath, "r");
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let bytesRead;
    while (
      (bytesRead = fs.readSync(
        fileDescriptor,
        buffer,
        0,
        buffer.length,
        null,
      )) > 0
    ) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fileDescriptor);
  }
  return hash.digest("hex");
}

function collectReleaseArtifacts(outputDirectory) {
  const artifacts = listFilesRecursively(outputDirectory)
    .filter(isReleaseArtifact)
    .map((filePath) => ({
      name: path.basename(filePath),
      sha256: hashFile(filePath),
      size: fs.statSync(filePath).size,
    }))
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));

  const duplicateNames = artifacts
    .filter((artifact, index) =>
      artifacts.some(
        (candidate, candidateIndex) =>
          candidateIndex !== index && candidate.name === artifact.name,
      ),
    )
    .map((artifact) => artifact.name);

  if (duplicateNames.length > 0) {
    throw new Error(
      `Release artifacts must have unique basenames: ${[...new Set(duplicateNames)].join(", ")}`,
    );
  }
  if (artifacts.length === 0) {
    throw new Error(`No release artifacts found under ${outputDirectory}`);
  }

  return artifacts;
}

function requireEnvironment(name, environment = process.env) {
  const value = environment[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }
  return value;
}

function createReleaseProvenance({
  environment = process.env,
  outputDirectory,
  platform,
}) {
  const repository = requireEnvironment("GITHUB_REPOSITORY", environment);
  const [owner, name] = repository.split("/");
  if (!owner || !name) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
  }

  const version = requireEnvironment("RELEASE_VERSION", environment);
  const tag = requireEnvironment("RELEASE_TAG", environment);
  if (tag !== `v${version}`) {
    throw new Error(`Release tag ${tag} does not match version ${version}`);
  }

  return {
    schemaVersion: PROVENANCE_SCHEMA_VERSION,
    repository: {
      id: requireEnvironment("GITHUB_REPOSITORY_ID", environment),
      name,
      owner,
    },
    source: {
      commit: requireEnvironment("GITHUB_SHA", environment),
      ref: requireEnvironment("GITHUB_REF", environment),
      runAttempt: requireEnvironment("GITHUB_RUN_ATTEMPT", environment),
      runId: requireEnvironment("GITHUB_RUN_ID", environment),
      workflow: RELEASE_WORKFLOW,
    },
    release: { platform, tag, version },
    artifacts: collectReleaseArtifacts(outputDirectory),
  };
}

function main() {
  const [outputPath, platform, outputDirectory = "out/make"] =
    process.argv.slice(2);
  if (!outputPath || !platform) {
    throw new Error(
      "Usage: generate-release-provenance.js <output-path> <platform> [artifact-directory]",
    );
  }

  const provenance = createReleaseProvenance({ outputDirectory, platform });
  fs.writeFileSync(outputPath, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(
    `Wrote ${outputPath} for ${provenance.artifacts.length} ${platform} release artifacts.`,
  );
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error("Failed to generate release provenance:", error.message);
    process.exit(1);
  }
}

module.exports = {
  collectReleaseArtifacts,
  createReleaseProvenance,
  isReleaseArtifact,
};
