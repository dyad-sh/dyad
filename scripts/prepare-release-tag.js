#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const DEFAULT_OWNER = "dyad-sh";
const DEFAULT_REPO = "dyad";

function readPackageVersion(packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error(`No package.json version found at ${packageJsonPath}`);
  }
  return packageJson.version;
}

async function githubRequest({ owner, path, repo, token }) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "dyad-release-tag-preparer",
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API GET ${path} failed: ${response.status} ${response.statusText}\n${text}`,
    );
  }

  return response.json();
}

async function findReleaseByTag({ owner, repo, tagName, token }) {
  for (let page = 1; page <= 5; page += 1) {
    const releases = await githubRequest({
      owner,
      path: `/releases?per_page=100&page=${page}`,
      repo,
      token,
    });
    const release = releases.find(
      (candidate) => candidate.tag_name === tagName,
    );

    if (release) {
      return release;
    }

    if (releases.length < 100) {
      break;
    }
  }

  return null;
}

function assertReleaseCanMoveTag({ release, tagName }) {
  if (release && !release.draft) {
    throw new Error(
      `Release ${tagName} is already published; refusing to move its tag.`,
    );
  }
}

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: "pipe" }).trim();
}

function pushTagToSha({ currentSha, tagName }) {
  runGit(["tag", "-f", tagName, currentSha]);
  runGit(["push", "origin", `refs/tags/${tagName}`, "--force"]);
}

function getRemoteTagSha(tagName) {
  const output = runGit([
    "ls-remote",
    "--tags",
    "origin",
    `refs/tags/${tagName}`,
  ]);
  if (!output) {
    return null;
  }

  const [sha] = output.split(/\s+/);
  return sha || null;
}

function verifyRemoteTagSha({ currentSha, tagName }) {
  const tagSha = getRemoteTagSha(tagName);
  if (!tagSha) {
    throw new Error(`Remote tag ${tagName} was not found.`);
  }

  if (tagSha !== currentSha) {
    throw new Error(
      `Remote tag ${tagName} points to ${tagSha}, expected ${currentSha}.`,
    );
  }
}

function writeGithubOutputs({ outputPath, outputs }) {
  if (!outputPath) {
    return;
  }

  fs.appendFileSync(
    outputPath,
    Object.entries(outputs)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n") + "\n",
  );
}

function getRepoParts(repository) {
  if (!repository) {
    return { owner: DEFAULT_OWNER, repo: DEFAULT_REPO };
  }

  const [owner, repo] = repository.split("/");
  if (!owner || !repo) {
    throw new Error(`Invalid GITHUB_REPOSITORY value: ${repository}`);
  }
  return { owner, repo };
}

async function prepareReleaseTag({
  currentSha,
  owner,
  packageJsonPath = path.join(__dirname, "..", "package.json"),
  repo,
  token,
}) {
  if (!currentSha) {
    throw new Error("GITHUB_SHA environment variable is required");
  }
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const version = readPackageVersion(packageJsonPath);
  const tagName = `v${version}`;
  const release = await findReleaseByTag({ owner, repo, tagName, token });
  assertReleaseCanMoveTag({ release, tagName });
  pushTagToSha({ currentSha, tagName });

  return {
    releaseState: release ? "draft" : "missing",
    tagName,
    version,
  };
}

function verifyPreparedReleaseTag({
  currentSha,
  packageJsonPath = path.join(__dirname, "..", "package.json"),
}) {
  if (!currentSha) {
    throw new Error("GITHUB_SHA environment variable is required");
  }

  const version = readPackageVersion(packageJsonPath);
  const tagName = `v${version}`;
  verifyRemoteTagSha({ currentSha, tagName });

  return { tagName, version };
}

async function main() {
  const mode = process.argv[2] ?? "prepare";
  const { owner, repo } = getRepoParts(process.env.GITHUB_REPOSITORY);

  if (mode === "prepare") {
    const result = await prepareReleaseTag({
      currentSha: process.env.GITHUB_SHA,
      owner,
      repo,
      token: process.env.GITHUB_TOKEN,
    });
    writeGithubOutputs({
      outputPath: process.env.GITHUB_OUTPUT,
      outputs: {
        release_state: result.releaseState,
        tag: result.tagName,
        version: result.version,
      },
    });
    console.log(
      `Pinned ${result.tagName} to ${process.env.GITHUB_SHA}; release state was ${result.releaseState}.`,
    );
    return;
  }

  if (mode === "verify") {
    const result = verifyPreparedReleaseTag({
      currentSha: process.env.GITHUB_SHA,
    });
    console.log(
      `Verified ${result.tagName} points to ${process.env.GITHUB_SHA}.`,
    );
    return;
  }

  throw new Error(`Unknown mode: ${mode}`);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to prepare release tag:", error.message);
    process.exit(1);
  });
}

module.exports = {
  assertReleaseCanMoveTag,
  findReleaseByTag,
  getRepoParts,
  getRemoteTagSha,
  prepareReleaseTag,
  readPackageVersion,
  verifyPreparedReleaseTag,
};
