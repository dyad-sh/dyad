import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const repository = "dyad-sh/dyad";

export function runPromotionCommand(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "pipe",
    // git show must also accommodate the repository's large package-lock.json.
    maxBuffer: 32 * 1024 * 1024,
  });
}

export async function promotePreviousBeta({
  cwd,
  stableVersion,
  confirm,
  log = console.log,
  execute = (command, args) => runPromotionCommand(command, args, cwd),
}) {
  const git = (...args) => execute("git", args).trim();
  const api = (path, projection) =>
    JSON.parse(
      execute("gh", ["api", `repos/${repository}/${path}`, "--jq", projection]),
    );

  if (git("status", "--porcelain")) {
    throw new Error("Commit or stash local changes before promoting a beta.");
  }
  if (!/^\d+\.\d+\.\d+$/.test(stableVersion)) {
    throw new Error("Provide the stable version selected for promotion.");
  }

  // GitHub's releases endpoint is ordered by creation, not publication date.
  const releases = [];
  for (let page = 1; ; page++) {
    const batch = api(
      `releases?per_page=100&page=${page}`,
      "map({tag_name, prerelease, draft, published_at})",
    );
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  if (
    releases.some(
      (candidate) =>
        !candidate.prerelease &&
        !candidate.draft &&
        candidate.tag_name === `v${stableVersion}`,
    )
  ) {
    throw new Error(`Stable release v${stableVersion} already exists.`);
  }
  const release = releases
    .filter(
      (candidate) =>
        candidate.prerelease &&
        !candidate.draft &&
        candidate.tag_name.startsWith(`v${stableVersion}-beta.`) &&
        /^v\d+\.\d+\.\d+-beta\.\d+$/.test(candidate.tag_name),
    )
    .sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0];
  if (!release)
    throw new Error(`No published beta found for v${stableVersion}.`);
  const match = /^v(\d+)\.(\d+)\.(\d+)-beta\.\d+$/.exec(release.tag_name);
  if (!match) throw new Error(`Invalid beta tag: ${release.tag_name}`);
  const version = `${match[1]}.${match[2]}.${match[3]}`;
  const branch = `release-${match[1]}.${match[2]}.x`;
  const answer = await confirm(
    `  Promote ${release.tag_name} to v${version} on ${branch}? [y/N] `,
  );
  if (!/^(y|yes)$/i.test(answer.trim())) {
    log("  Cancelled.");
    return;
  }

  // Resolve the tag, not target_commitish (which can be a moving branch).
  const { sha } = api(
    `commits/${encodeURIComponent(release.tag_name)}`,
    "{sha}",
  );
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("Invalid release commit SHA.");
  const runs = [];
  for (let page = 1; ; page++) {
    const batch = api(
      `actions/workflows/release.yml/runs?head_sha=${sha}&status=success&per_page=100&page=${page}`,
      "{workflow_runs: [.workflow_runs[] | {head_sha, conclusion, created_at, html_url}]}",
    ).workflow_runs;
    runs.push(...batch);
    if (batch.length < 100) break;
  }
  const workflow = runs
    .filter((run) => run.head_sha === sha && run.conclusion === "success")
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))[0];
  if (!workflow) {
    throw new Error(
      `No successful release workflow found for ${release.tag_name} (${sha}).`,
    );
  }
  log(`  Release workflow: ${workflow.html_url}`);
  log(`  Release commit: ${workflow.head_sha}`);

  const remotes = git("remote")
    .split(/\s+/)
    .filter(Boolean)
    .map((name) => ({
      name,
      repo: /github\.com[:/]([^/]+\/[^/]+?)(?:\.git)?\/?$/.exec(
        git("remote", "get-url", "--push", name),
      )?.[1],
    }));
  const releaseRemote = remotes.find(
    ({ repo }) => repo?.toLowerCase() === repository,
  );
  const isForkRemote = ({ repo }) => repo && repo.toLowerCase() !== repository;
  const forkRemote =
    remotes.find(
      (candidate) => candidate.name === "origin" && isForkRemote(candidate),
    ) ?? remotes.find(isForkRemote);
  if (!releaseRemote)
    throw new Error(
      `No Git remote points to ${repository} for the release branch.`,
    );
  if (!forkRemote)
    throw new Error("No contributor fork remote found for the release PR.");
  if (
    git("branch", "--list", branch) ||
    git("ls-remote", "--heads", releaseRemote.name, `refs/heads/${branch}`) ||
    git("ls-remote", "--heads", forkRemote.name, `refs/heads/${branch}`)
  ) {
    throw new Error(
      `Branch ${branch} already exists; refusing to overwrite it.`,
    );
  }

  git("fetch", `https://github.com/${repository}.git`, workflow.head_sha);
  // Read from the selected commit before checkout; never reuse HEAD's manifests.
  const files = ["package.json", "package-lock.json"].map((name) => ({
    name,
    contents: JSON.parse(git("show", `${workflow.head_sha}:${name}`)),
  }));
  if (
    files.some(
      ({ contents }) => contents.version !== release.tag_name.slice(1),
    ) ||
    files[1].contents.packages?.[""]?.version !== release.tag_name.slice(1)
  ) {
    throw new Error(
      "Release commit package versions do not match the selected beta.",
    );
  }
  git("checkout", "-b", branch, workflow.head_sha);
  for (const { name, contents } of files) {
    contents.version = version;
    if (name === "package-lock.json") contents.packages[""].version = version;
    writeFileSync(resolve(cwd, name), JSON.stringify(contents, null, 2) + "\n");
  }
  git("add", "package.json", "package-lock.json");
  git("commit", "-m", `Bump to v${version}`);
  git("push", releaseRemote.name, `${sha}:refs/heads/${branch}`);
  git("push", "-u", forkRemote.name, branch);
  log(`  Created ${repository}:${branch} at ${sha}.`);
  log(`  Pushed the stable version bump to ${forkRemote.repo}:${branch}.`);
  const head = `${forkRemote.repo.split("/")[0]}:${branch}`;
  const prUrl = execute("gh", [
    "pr",
    "create",
    "--repo",
    repository,
    "--base",
    branch,
    "--head",
    head,
    "--no-maintainer-edit",
    "--title",
    `Promote ${release.tag_name} to v${version}`,
    "--body",
    `Promote ${release.tag_name} to stable from release workflow ${workflow.html_url} (commit ${workflow.head_sha}).\n\nMerge this version bump into ${repository}:${branch}, then run release.yml on that branch.`,
  ]).trim();
  log(`  PR created: ${prUrl}`);
  return prUrl;
}
