#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const DEFAULT_OWNER = "dyad-sh";
const DEFAULT_REPO = "dyad";
const WORKFLOW_ID = "release.yml";

function isPrereleaseVersion(version) {
  return version.includes("-");
}

function makeLatestForVersion(version) {
  return isPrereleaseVersion(version) ? "false" : "true";
}

function releasePayloadForVersion({ generatedNotes, version }) {
  return {
    name: generatedNotes.name,
    body: generatedNotes.body,
    draft: true,
    prerelease: isPrereleaseVersion(version),
    make_latest: makeLatestForVersion(version),
  };
}

function selectPreviousDifferentVersionRun({
  currentVersion,
  runsWithVersions,
}) {
  return (
    runsWithVersions.find(
      (run) => run.conclusion === "success" && run.version !== currentVersion,
    ) ?? null
  );
}

function readPackageVersion(packageJsonPath) {
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error(`No package.json version found at ${packageJsonPath}`);
  }
  return packageJson.version;
}

function decodeBase64Content(content) {
  return Buffer.from(content.replace(/\n/g, ""), "base64").toString("utf8");
}

async function githubRequest({
  body,
  method = "GET",
  owner,
  path,
  repo,
  token,
}) {
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}${path}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "dyad-release-metadata",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      ...(body == null ? {} : { body: JSON.stringify(body) }),
    },
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(
      `GitHub API ${method} ${path} failed: ${response.status} ${response.statusText}\n${text}`,
    );
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function getPackageVersionAtRef({ owner, ref, repo, token }) {
  const encodedPath = encodeURIComponent("package.json");
  const packageJsonContent = await githubRequest({
    owner,
    path: `/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    repo,
    token,
  });
  const packageJson = JSON.parse(
    decodeBase64Content(packageJsonContent.content),
  );

  if (typeof packageJson.version !== "string" || !packageJson.version) {
    throw new Error(`No package.json version found at ref ${ref}`);
  }

  return packageJson.version;
}

async function findPreviousDifferentVersionRun({
  currentVersion,
  owner,
  repo,
  token,
}) {
  for (let page = 1; page <= 5; page += 1) {
    const runs = await githubRequest({
      owner,
      path: `/actions/workflows/${WORKFLOW_ID}/runs?status=success&per_page=100&page=${page}`,
      repo,
      token,
    });

    for (const run of runs.workflow_runs ?? []) {
      const version = await getPackageVersionAtRef({
        owner,
        ref: run.head_sha,
        repo,
        token,
      });

      if (version !== currentVersion) {
        return {
          createdAt: run.created_at,
          databaseId: run.id,
          headSha: run.head_sha,
          htmlUrl: run.html_url,
          version,
        };
      }
    }

    if (!runs.workflow_runs || runs.workflow_runs.length < 100) {
      break;
    }
  }

  return null;
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

async function updateReleaseMetadata({
  currentSha,
  owner = DEFAULT_OWNER,
  packageJsonPath = path.join(__dirname, "..", "package.json"),
  repo = DEFAULT_REPO,
  token,
}) {
  if (!token) {
    throw new Error("GITHUB_TOKEN environment variable is required");
  }

  const version = readPackageVersion(packageJsonPath);
  const tagName = `v${version}`;
  const previousRun = await findPreviousDifferentVersionRun({
    currentVersion: version,
    owner,
    repo,
    token,
  });

  if (!previousRun) {
    throw new Error(
      `Could not find a successful ${WORKFLOW_ID} run for a previous package.json version`,
    );
  }

  const previousTagName = `v${previousRun.version}`;
  const generatedNotes = await githubRequest({
    body: {
      tag_name: tagName,
      target_commitish: currentSha,
      previous_tag_name: previousTagName,
    },
    method: "POST",
    owner,
    path: "/releases/generate-notes",
    repo,
    token,
  });

  const release = await findReleaseByTag({
    owner,
    repo,
    tagName,
    token,
  });

  if (!release) {
    throw new Error(
      `Release ${tagName} not found in published releases or drafts`,
    );
  }

  await githubRequest({
    body: releasePayloadForVersion({ generatedNotes, version }),
    method: "PATCH",
    owner,
    path: `/releases/${release.id}`,
    repo,
    token,
  });

  return {
    makeLatest: makeLatestForVersion(version),
    previousRun,
    previousTagName,
    prerelease: isPrereleaseVersion(version),
    tagName,
    version,
  };
}

async function main() {
  const result = await updateReleaseMetadata({
    currentSha: process.env.GITHUB_SHA,
    token: process.env.GITHUB_TOKEN,
  });

  console.log(
    `Updated ${result.tagName} release metadata using ${result.previousTagName} as the release-notes boundary.`,
  );
  console.log(
    `Release flags: prerelease=${result.prerelease}, make_latest=${result.makeLatest}`,
  );
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Failed to update release metadata:", error.message);
    process.exit(1);
  });
}

module.exports = {
  isPrereleaseVersion,
  makeLatestForVersion,
  releasePayloadForVersion,
  selectPreviousDifferentVersionRun,
  updateReleaseMetadata,
};
