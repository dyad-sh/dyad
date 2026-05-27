#!/usr/bin/env node
// Downloads and installs the Electron binary into node_modules/electron.
// Bypasses electron's bundled install.js (which exits 0 silently on some
// self-hosted runners) and logs every step so failures are visible in CI.

import { createRequire } from "node:module";
import { promises as fs } from "node:fs";
import path from "node:path";
import process from "node:process";

const require = createRequire(import.meta.url);
const electronDir = path.resolve("node_modules/electron");

function log(msg) {
  console.log(`[install-electron] ${msg}`);
}

function fail(msg, err) {
  console.error(`[install-electron] FAIL: ${msg}`);
  if (err) console.error(err.stack || err);
  process.exit(1);
}

function platformPath() {
  switch (process.platform) {
    case "darwin":
    case "mas":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    case "linux":
    case "freebsd":
    case "openbsd":
      return "electron";
    default:
      throw new Error(`Unsupported platform: ${process.platform}`);
  }
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  log(
    `node=${process.version} platform=${process.platform} arch=${process.arch}`,
  );
  log(`electronDir=${electronDir}`);

  if (!(await exists(electronDir))) {
    fail(`${electronDir} does not exist — run npm ci first`);
  }

  const electronPkg = require(path.join(electronDir, "package.json"));
  const version = electronPkg.version;
  log(`electron version: ${version}`);

  let downloadArtifact, extract;
  try {
    ({ downloadArtifact } = await import("@electron/get"));
  } catch (err) {
    fail("could not import @electron/get", err);
  }
  try {
    extract = (await import("extract-zip")).default;
  } catch (err) {
    fail("could not import extract-zip", err);
  }

  const distPath = path.join(electronDir, "dist");
  const pathFile = path.join(electronDir, "path.txt");

  log(`removing stale ${distPath} and ${pathFile}`);
  await fs.rm(distPath, { recursive: true, force: true });
  await fs.rm(pathFile, { force: true });

  let checksums;
  try {
    checksums = require(path.join(electronDir, "checksums.json"));
  } catch {
    log(
      `(warning) no checksums.json in electron package — proceeding without checksum verification`,
    );
  }

  log(
    `downloading electron-v${version}-${process.platform}-${process.arch}.zip (force=true)`,
  );
  let zipPath;
  try {
    zipPath = await downloadArtifact({
      version,
      artifactName: "electron",
      force: true,
      platform: process.platform,
      arch: process.arch,
      checksums,
    });
  } catch (err) {
    fail("downloadArtifact threw", err);
  }
  log(`downloaded to ${zipPath}`);

  const stat = await fs.stat(zipPath).catch(() => null);
  if (!stat || stat.size === 0) {
    fail(
      `downloaded zip is missing or empty: ${zipPath} (size=${stat?.size ?? "n/a"})`,
    );
  }
  log(`zip size: ${stat.size} bytes`);

  log(`extracting to ${distPath}`);
  try {
    await extract(zipPath, { dir: distPath });
  } catch (err) {
    fail("extract threw", err);
  }

  const extracted = await fs.readdir(distPath).catch(() => []);
  log(
    `extracted ${extracted.length} entries: ${extracted.slice(0, 5).join(", ")}${extracted.length > 5 ? ", ..." : ""}`,
  );
  if (extracted.length === 0) {
    fail(`extraction produced no files in ${distPath}`);
  }

  // electron.d.ts in the zip needs to be hoisted up one level
  const srcTypeDef = path.join(distPath, "electron.d.ts");
  const dstTypeDef = path.join(electronDir, "electron.d.ts");
  if (await exists(srcTypeDef)) {
    log(`moving electron.d.ts up to ${dstTypeDef}`);
    await fs.rename(srcTypeDef, dstTypeDef);
  }

  const pp = platformPath();
  log(`writing path.txt with content: ${pp}`);
  await fs.writeFile(pathFile, pp);

  // Verify the executable actually exists at the resolved path
  const electronExe = path.join(distPath, pp);
  if (!(await exists(electronExe))) {
    fail(`electron executable not found at ${electronExe} after extraction`);
  }
  log(`OK — electron binary installed at ${electronExe}`);
}

main().catch((err) => fail("unexpected error", err));
