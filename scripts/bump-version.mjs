#!/usr/bin/env node

import { readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { createInterface } from "readline";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// ANSI colors
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const _yellow = (s) => `\x1b[33m${s}\x1b[0m`;
const magenta = (s) => `\x1b[35m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, "../package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
const currentVersion = pkg.version;

function parseVersion(version) {
  const match = version.match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/);
  if (!match) {
    console.error(red(`\n  Error: Cannot parse version: ${version}\n`));
    process.exit(1);
  }
  return {
    major: parseInt(match[1]),
    minor: parseInt(match[2]),
    patch: parseInt(match[3]),
    beta: match[4] != null ? parseInt(match[4]) : null,
  };
}

function formatVersion(v) {
  const base = `${v.major}.${v.minor}.${v.patch}`;
  return v.beta != null ? `${base}-beta.${v.beta}` : base;
}

const parsed = parseVersion(currentVersion);

const options = [];

// Current version stable: drop beta prerelease tag
options.push({
  label: "Current version stable",
  version: formatVersion({
    major: parsed.major,
    minor: parsed.minor,
    patch: parsed.patch,
    beta: null,
  }),
});

// Next version-beta: bump minor, start at beta.1
options.push({
  label: "Next version beta",
  version: formatVersion({
    major: parsed.major,
    minor: parsed.minor + 1,
    patch: 0,
    beta: 1,
  }),
});

// Next beta: keep version, bump beta number (only if currently a beta)
if (parsed.beta != null) {
  options.push({
    label: "Next beta",
    version: formatVersion({ ...parsed, beta: parsed.beta + 1 }),
  });
}

console.log();
console.log(bold("  Dyad Version Bump"));
console.log(dim("  ─────────────────"));
console.log(`  Current version: ${cyan(`v${currentVersion}`)}`);
console.log();
options.forEach((opt, i) => {
  const num = bold(`  ${i + 1})`);
  const label = opt.label.padEnd(24);
  const ver = magenta(`v${opt.version}`);
  console.log(`${num} ${label} ${dim("→")} ${ver}`);
});
console.log();

const rl = createInterface({ input: process.stdin, output: process.stdout });

rl.question(`  ${bold("Select option:")} `, (answer) => {
  rl.close();
  const index = parseInt(answer) - 1;
  if (isNaN(index) || index < 0 || index >= options.length) {
    console.error(red("\n  Invalid selection.\n"));
    process.exit(1);
  }

  const selected = options[index];
  const newVersion = selected.version;
  const tag = `v${newVersion}`;
  const branchTag = tag.replaceAll(".", "-");
  const branch = `bump-to-${branchTag}`;

  console.log();
  console.log(dim("  ─────────────────"));
  console.log(`  Bumping to ${green(tag)}`);
  console.log();

  // Update package.json
  pkg.version = newVersion;
  writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
  step("Updated package.json");

  // Git operations
  run(`git checkout -b ${branch}`);
  step("Created branch " + cyan(branch));

  run(`git add package.json`);
  run(`git commit -m "Bump to ${tag}"`);
  step("Committed changes");

  run(`git push -u origin ${branch}`);
  step("Pushed to remote");

  const prUrl = run(
    `gh pr create --title "Bump to ${tag}" --body "#skip-bb"`,
  ).trim();
  step("Created pull request");

  console.log();
  console.log(green(bold(`  Done!`)) + ` PR created for ${green(tag)}`);
  console.log(`  ${cyan(prUrl)}`);
  console.log();
});

function step(msg) {
  console.log(`  ${green("✔")} ${msg}`);
}

function run(cmd) {
  return execSync(cmd, {
    stdio: "pipe",
    cwd: resolve(__dirname, ".."),
  }).toString();
}
