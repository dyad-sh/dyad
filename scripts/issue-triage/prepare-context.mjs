// Builds the trusted context the triage prompt and apply script rely on:
// the current app version, the list of published releases, live service
// status for GitHub and Supabase, and the playbook text. Runs in a trusted
// workflow step, never inside the agent, so the agent needs no network access.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATUS_PAGES = {
  GitHub: "https://www.githubstatus.com/api/v2/status.json",
  Supabase: "https://status.supabase.com/api/v2/status.json",
};

export function parseReleaseList(entries) {
  return entries
    .filter((entry) => entry.isDraft !== true)
    .map((entry) => ({
      tag: entry.tagName,
      version: `${entry.tagName}`.replace(/^v/, ""),
      publishedAt: `${entry.publishedAt ?? ""}`.slice(0, 10),
      prerelease: entry.isPrerelease === true,
    }));
}

export function formatReleaseIndex(releases) {
  if (releases.length === 0) return "(release list unavailable)";
  return releases
    .map(
      (release) =>
        `${release.version} (${release.prerelease ? "beta" : "stable"}, ${release.publishedAt})`,
    )
    .join("\n");
}

export function formatServiceStatus(status) {
  const lines = Object.entries(status).map(
    ([name, text]) => `${name}: ${text}`,
  );
  return lines.length > 0 ? lines.join("\n") : "(not checked)";
}

async function fetchStatusDescription(url) {
  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok)
      return `unknown (status page returned ${response.status})`;
    const body = await response.json();
    return body?.status?.description ?? "unknown";
  } catch {
    return "unknown (could not reach status page)";
  }
}

function listReleases(repository, limit) {
  try {
    const output = execFileSync(
      "gh",
      [
        "release",
        "list",
        "--repo",
        repository,
        "--limit",
        String(limit),
        "--json",
        "tagName,publishedAt,isDraft,isPrerelease",
      ],
      { encoding: "utf8" },
    );
    return parseReleaseList(JSON.parse(output));
  } catch (error) {
    console.warn(`::warning::Could not list releases: ${error.message}`);
    return [];
  }
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const outputPath = process.env.TRIAGE_CONTEXT_PATH;
  const playbookPath = process.env.PLAYBOOK_PATH;
  const packageJsonPath = process.env.PACKAGE_JSON_PATH || "package.json";
  const fetchStatus = process.env.FETCH_SERVICE_STATUS !== "false";
  const releaseLimit = Number.parseInt(process.env.RELEASE_LIMIT || "40", 10);

  if (!repository) throw new Error("GITHUB_REPOSITORY is required");
  if (!outputPath) throw new Error("TRIAGE_CONTEXT_PATH is required");

  const currentVersion = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf8"),
  ).version;
  const releases = listReleases(repository, releaseLimit);
  const serviceStatus = {};
  if (fetchStatus) {
    for (const [name, url] of Object.entries(STATUS_PAGES)) {
      serviceStatus[name] = await fetchStatusDescription(url);
    }
  }
  const playbook = playbookPath ? fs.readFileSync(playbookPath, "utf8") : "";

  const context = {
    generatedAt: new Date().toISOString(),
    currentVersion,
    releases,
    serviceStatus,
    playbook,
    templateVars: {
      CURRENT_VERSION: currentVersion,
      RELEASE_INDEX: formatReleaseIndex(releases),
      SERVICE_STATUS: formatServiceStatus(serviceStatus),
      PLAYBOOK: playbook,
    },
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(context, null, 2));
  console.log(
    `Wrote ${outputPath}: version ${currentVersion}, ${releases.length} releases, status ${JSON.stringify(serviceStatus)}`,
  );
}

const invokedDirectly =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  await main();
}
