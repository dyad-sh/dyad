#!/usr/bin/env node
/*
 * Build a distributable installer ZIP for one platform.
 *
 *   node scripts/build-installer.mjs win    -> out/JoyCreate-Installer-Windows.zip
 *   node scripts/build-installer.mjs mac    -> out/JoyCreate-Installer-macOS.zip
 *   node scripts/build-installer.mjs linux  -> out/JoyCreate-Installer-Linux.zip
 *
 * Flags:
 *   --skip-build   Reuse existing artifacts in out/make/
 *
 * The script:
 *   1. (optional) Runs `npm run make` to produce platform artifacts via Forge.
 *   2. Locates the artifact(s) in out/make/.
 *   3. Stages them with the matching bootstrapper from installer/.
 *   4. Zips the result to out/JoyCreate-Installer-<Platform>.zip.
 *
 * End users get ONE zip. They unzip and double-click the launcher inside.
 */

import { execSync } from "node:child_process";
import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import AdmZip from "adm-zip";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const repoRoot   = path.resolve(__dirname, "..");
const outDir     = path.join(repoRoot, "out");
const makeDir    = path.join(outDir, "make");
const installer  = path.join(repoRoot, "installer");

const args   = process.argv.slice(2);
const target = (args.find(a => !a.startsWith("--")) || detectHost()).toLowerCase();
const skipBuild = args.includes("--skip-build");

function detectHost() {
  switch (os.platform()) {
    case "win32":  return "win";
    case "darwin": return "mac";
    case "linux":  return "linux";
    default: throw new Error(`Unsupported host platform: ${os.platform()}`);
  }
}

const TARGETS = {
  win: {
    label: "Windows",
    zipName: "JoyCreate-Installer-Windows.zip",
    bootstrap: ["Install-JoyCreate.bat", "Install-JoyCreate.ps1", "README.txt"],
    findArtifacts: async () => {
      const squirrel = path.join(makeDir, "squirrel.windows");
      if (!existsSync(squirrel)) {
        throw new Error(`Missing ${squirrel}. Run 'npm run make' on Windows first.`);
      }
      return walk(squirrel, f => /Setup\.exe$/i.test(f));
    },
  },
  mac: {
    label: "macOS",
    zipName: "JoyCreate-Installer-macOS.zip",
    bootstrap: ["Install-JoyCreate.command", "README.txt"],
    findArtifacts: async () => {
      const dir = path.join(makeDir, "zip", "darwin");
      if (!existsSync(dir)) {
        throw new Error(`Missing ${dir}. Run 'npm run make' on macOS first.`);
      }
      return walk(dir, f => f.endsWith(".zip"));
    },
  },
  linux: {
    label: "Linux",
    zipName: "JoyCreate-Installer-Linux.zip",
    bootstrap: ["install-joycreate.sh", "README.txt"],
    findArtifacts: async () => {
      const debDir = path.join(makeDir, "deb");
      const rpmDir = path.join(makeDir, "rpm");
      const found = [];
      if (existsSync(debDir)) found.push(...await walk(debDir, f => f.endsWith(".deb")));
      if (existsSync(rpmDir)) found.push(...await walk(rpmDir, f => f.endsWith(".rpm")));
      if (found.length === 0) {
        throw new Error(`No .deb or .rpm under ${makeDir}. Run 'npm run make' on Linux first.`);
      }
      return found;
    },
  },
};

async function walk(dir, predicate) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full, predicate));
    else if (predicate(full)) out.push(full);
  }
  return out;
}

async function zipDir(srcDir, zipPath) {
  await fs.mkdir(path.dirname(zipPath), { recursive: true });
  const zip = new AdmZip();
  zip.addLocalFolder(srcDir);
  zip.writeZip(zipPath);
}

function step(msg)  { console.log(`\n==> ${msg}`); }

async function main() {
  const cfg = TARGETS[target];
  if (!cfg) throw new Error(`Unknown target '${target}'. Use win | mac | linux.`);

  if (!skipBuild) {
    step(`Running 'npm run make' for ${cfg.label} (this can take several minutes)...`);
    execSync("npm run make", { cwd: repoRoot, stdio: "inherit" });
  } else {
    step("Skipping build (--skip-build).");
  }

  step(`Locating ${cfg.label} artifacts...`);
  const artifacts = await cfg.findArtifacts();
  for (const a of artifacts) console.log(`    - ${path.relative(repoRoot, a)}`);

  step("Staging installer files...");
  const stage = path.join(outDir, `installer-stage-${target}`);
  await fs.rm(stage, { recursive: true, force: true });
  await fs.mkdir(stage, { recursive: true });

  for (const file of cfg.bootstrap) {
    const src = path.join(installer, file);
    const dst = path.join(stage, file);
    await fs.copyFile(src, dst);
    if (process.platform !== "win32" && /\.(sh|command)$/.test(file)) {
      await fs.chmod(dst, 0o755);
    }
  }
  for (const a of artifacts) {
    await fs.copyFile(a, path.join(stage, path.basename(a)));
  }

  step(`Zipping ${cfg.zipName}...`);
  const zipPath = path.join(outDir, cfg.zipName);
  await fs.rm(zipPath, { force: true });
  await zipDir(stage, zipPath);

  const sizeMb = ((await fs.stat(zipPath)).size / 1024 / 1024).toFixed(1);
  console.log(`\n=====================================================`);
  console.log(`  Done: ${zipPath}  (${sizeMb} MB)`);
  console.log(`=====================================================\n`);
  console.log(`  Ship that single ZIP to your ${cfg.label} users.`);
  console.log(`  They unzip it and double-click the launcher inside.\n`);
}

main().catch(err => {
  console.error(`\nXX  ${err.message}`);
  process.exit(1);
});
