import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TRANSIENT_TOP_LEVEL_ENTRIES = new Set([
  ".DS_Store",
  "Cache",
  "Code Cache",
  "Crashpad",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "DevToolsActivePort",
  "GPUCache",
  "dyad-crash-reports",
  "logs",
  "typescript-cache",
]);

const TRANSIENT_NAME_PREFIXES = [
  ".com.electron.",
  ".com.github.Electron.",
  "Singleton",
];

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export function getProductionUserDataPath({
  platform = process.platform,
  env = process.env,
  homeDir = os.homedir(),
} = {}) {
  if (env.DYAD_PROD_USER_DATA_DIR) {
    return path.resolve(env.DYAD_PROD_USER_DATA_DIR);
  }

  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "dyad");
  }

  if (platform === "win32") {
    if (!env.APPDATA) {
      throw new Error(
        "APPDATA is not set; cannot locate Dyad's production data.",
      );
    }
    return path.join(env.APPDATA, "dyad");
  }

  return path.join(
    env.XDG_CONFIG_HOME || path.join(homeDir, ".config"),
    "dyad",
  );
}

export function shouldCopyProductionPath(sourceRoot, sourcePath) {
  const relativePath = path.relative(sourceRoot, sourcePath);
  if (!relativePath) return true;

  const topLevelName = relativePath.split(path.sep)[0];
  if (TRANSIENT_TOP_LEVEL_ENTRIES.has(topLevelName)) return false;
  if (
    TRANSIENT_NAME_PREFIXES.some((prefix) => topLevelName.startsWith(prefix))
  ) {
    return false;
  }

  // Unix domain sockets cannot be copied and only represent a running or stale
  // Electron instance, never durable user data.
  return !lstatSync(sourcePath).isSocket();
}

export function getProcessesUsingDataDirectories(
  dataDirectories,
  { runSync = execFileSync, platform = process.platform } = {},
) {
  if (platform === "win32") {
    try {
      const output = runSync(
        "tasklist",
        ["/FI", "IMAGENAME eq dyad.exe", "/FO", "CSV", "/NH"],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
        },
      );
      return output
        .split(/\r?\n/)
        .map((line) => line.match(/^"dyad\.exe","(\d+)"/i)?.[1])
        .filter(Boolean);
    } catch (error) {
      throw new Error(
        "Could not check whether Dyad is running. Close Dyad and try again.",
        { cause: error },
      );
    }
  }

  const openPaths = dataDirectories
    .flatMap((directory) => [
      path.join(directory, "sqlite.db"),
      path.join(directory, "Cookies"),
    ])
    .filter(existsSync);

  if (openPaths.length === 0) return [];

  try {
    const output = runSync("lsof", ["-t", "--", ...openPaths], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return [...new Set(output.trim().split(/\s+/).filter(Boolean))];
  } catch (error) {
    // lsof exits with status 1 when no process has any of the files open.
    if (error?.status === 1) return [];
    throw new Error(
      "Could not check whether Dyad is running. Install lsof or close Dyad and try again.",
      { cause: error },
    );
  }
}

export function copyProductionDataToDev({
  source = getProductionUserDataPath(),
  destination = path.join(repoRoot, "userData"),
  runSync = execFileSync,
  platform = process.platform,
  now = Date.now,
} = {}) {
  source = path.resolve(source);
  destination = path.resolve(destination);

  if (!existsSync(source) || !lstatSync(source).isDirectory()) {
    throw new Error(`Production user data directory does not exist: ${source}`);
  }

  if (
    existsSync(destination) &&
    realpathSync(source) === realpathSync(destination)
  ) {
    throw new Error("Production and development user data paths are the same.");
  }

  const activePids = getProcessesUsingDataDirectories([source, destination], {
    runSync,
    platform,
  });
  if (activePids.length > 0) {
    throw new Error(
      `Dyad is using the production or development data (PID${activePids.length === 1 ? "" : "s"} ${activePids.join(", ")}). Close all Dyad instances and try again.`,
    );
  }

  mkdirSync(path.dirname(destination), { recursive: true });
  const suffix = `${process.pid}-${now()}`;
  const staging = `${destination}.copying-${suffix}`;
  const previous = `${destination}.previous-${suffix}`;
  let movedPrevious = false;

  try {
    cpSync(source, staging, {
      recursive: true,
      preserveTimestamps: true,
      filter: (sourcePath) => shouldCopyProductionPath(source, sourcePath),
    });

    if (existsSync(destination)) {
      renameSync(destination, previous);
      movedPrevious = true;
    }

    try {
      renameSync(staging, destination);
    } catch (error) {
      if (movedPrevious) renameSync(previous, destination);
      movedPrevious = false;
      throw error;
    }

    if (movedPrevious) rmSync(previous, { recursive: true, force: true });
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }

  return { source, destination };
}

function main() {
  const { source, destination } = copyProductionDataToDev();
  console.log(
    `Copied Dyad production data from:\n  ${source}\nto:\n  ${destination}`,
  );
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
) {
  try {
    main();
  } catch (error) {
    console.error(`Failed to copy production data: ${error.message}`);
    process.exitCode = 1;
  }
}
