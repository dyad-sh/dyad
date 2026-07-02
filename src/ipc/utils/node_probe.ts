import { existsSync, readdirSync } from "fs";
import { homedir } from "os";
import path from "path";
import log from "electron-log";

import { getNodeVersionAtPath } from "./managed_node";

const logger = log.scope("node_probe");

export type NodeProbeOrigin =
  | "nodejs-installer"
  | "nvm-windows"
  | "nvm"
  | "fnm"
  | "mise"
  | "volta"
  | "homebrew"
  | "system-prefix";

export type NodeProbeCandidateDir = {
  binDir: string;
  origin: NodeProbeOrigin;
};

export type NodeProbeResult = {
  binDir: string;
  nodePath: string;
  version: string;
  origin: NodeProbeOrigin;
};

// Cap the number of version directories probed per version manager: users can
// accumulate many installed Node versions and each probe spawns a process.
const MAX_VERSION_DIRS_PER_ROOT = 2;
// Newly appeared installs should be picked up quickly while the setup card
// polls, without re-spawning probes on every status request.
const PROBE_CACHE_TTL_MS = 15_000;

export type NodeProbeContext = {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeDir: string;
  listSubdirectories: (dir: string) => string[];
};

function defaultListSubdirectories(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

export function parseNodeVersion(
  value: string,
): [number, number, number] | null {
  const match = value.match(/v?(\d+)\.(\d+)\.(\d+)/);
  if (!match) {
    return null;
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareParsedVersions(
  a: [number, number, number],
  b: [number, number, number],
): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) {
      return a[i] - b[i];
    }
  }
  return 0;
}

/**
 * Returns the version-like subdirectories of a version manager's install
 * root, newest first, capped so probing stays cheap.
 */
function newestVersionDirs(
  root: string,
  listSubdirectories: (dir: string) => string[],
): string[] {
  return listSubdirectories(root)
    .map((name) => ({ name, version: parseNodeVersion(name) }))
    .filter(
      (entry): entry is { name: string; version: [number, number, number] } =>
        entry.version !== null,
    )
    .sort((a, b) => compareParsedVersions(b.version, a.version))
    .slice(0, MAX_VERSION_DIRS_PER_ROOT)
    .map((entry) => entry.name);
}

/**
 * Well-known absolute locations where Node.js ends up installed. These are
 * probed without relying on the (possibly stale or corrupted) inherited
 * PATH: a GUI app never sees the shell init files where version managers
 * register themselves, and a broken PATH entry breaks every `shell: true`
 * spawn before it can even look for node.
 */
export function getNodeProbeCandidateDirs(
  context: NodeProbeContext,
): NodeProbeCandidateDir[] {
  const { platform, env, homeDir, listSubdirectories } = context;
  // Build candidate paths with the target platform's separators so the
  // generation logic is testable from any host platform.
  const paths = platform === "win32" ? path.win32 : path.posix;
  const candidates: NodeProbeCandidateDir[] = [];
  const add = (
    binDir: string | null | undefined,
    origin: NodeProbeOrigin,
  ): void => {
    if (binDir) {
      candidates.push({ binDir, origin });
    }
  };
  const addVersionManagerDirs = (
    root: string | null | undefined,
    origin: NodeProbeOrigin,
    binDirForVersion: (versionDir: string) => string,
  ): void => {
    if (!root) {
      return;
    }
    for (const versionDir of newestVersionDirs(root, listSubdirectories)) {
      add(binDirForVersion(paths.join(root, versionDir)), origin);
    }
  };

  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    add(paths.join(programFiles, "nodejs"), "nodejs-installer");
    if (env.LOCALAPPDATA) {
      // The official installer's per-user ("install for me only") location.
      add(
        paths.join(env.LOCALAPPDATA, "Programs", "nodejs"),
        "nodejs-installer",
      );
    }
    // nvm-windows keeps the active version behind a stable symlink dir.
    add(env.NVM_SYMLINK, "nvm-windows");
    const fnmDir =
      env.FNM_DIR ?? (env.APPDATA ? paths.join(env.APPDATA, "fnm") : null);
    addVersionManagerDirs(
      fnmDir ? paths.join(fnmDir, "node-versions") : null,
      "fnm",
      (versionDir) => paths.join(versionDir, "installation"),
    );
    const voltaHome =
      env.VOLTA_HOME ??
      (env.LOCALAPPDATA ? paths.join(env.LOCALAPPDATA, "Volta") : null);
    add(voltaHome ? paths.join(voltaHome, "bin") : null, "volta");
    return dedupeCandidates(candidates, platform);
  }

  if (platform === "darwin") {
    add("/opt/homebrew/bin", "homebrew");
  }
  add("/usr/local/bin", "system-prefix");

  const nvmDir = env.NVM_DIR ?? paths.join(homeDir, ".nvm");
  addVersionManagerDirs(
    paths.join(nvmDir, "versions", "node"),
    "nvm",
    (versionDir) => paths.join(versionDir, "bin"),
  );

  const fnmRoots = env.FNM_DIR
    ? [env.FNM_DIR]
    : [
        paths.join(homeDir, ".local", "share", "fnm"),
        ...(platform === "darwin"
          ? [paths.join(homeDir, "Library", "Application Support", "fnm")]
          : []),
      ];
  for (const fnmRoot of fnmRoots) {
    addVersionManagerDirs(
      paths.join(fnmRoot, "node-versions"),
      "fnm",
      (versionDir) => paths.join(versionDir, "installation", "bin"),
    );
  }

  const miseDataDir =
    env.MISE_DATA_DIR ??
    (env.XDG_DATA_HOME
      ? paths.join(env.XDG_DATA_HOME, "mise")
      : paths.join(homeDir, ".local", "share", "mise"));
  addVersionManagerDirs(
    paths.join(miseDataDir, "installs", "node"),
    "mise",
    (versionDir) => paths.join(versionDir, "bin"),
  );

  const voltaHome = env.VOLTA_HOME ?? paths.join(homeDir, ".volta");
  add(paths.join(voltaHome, "bin"), "volta");

  return dedupeCandidates(candidates, platform);
}

function dedupeCandidates(
  candidates: NodeProbeCandidateDir[],
  platform: NodeJS.Platform,
): NodeProbeCandidateDir[] {
  const seen = new Set<string>();
  const deduped: NodeProbeCandidateDir[] = [];
  for (const candidate of candidates) {
    const key =
      platform === "win32" ? candidate.binDir.toLowerCase() : candidate.binDir;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}

export function pickNewestNodeCandidate<T extends { version: string }>(
  candidates: T[],
): T | null {
  let best: T | null = null;
  let bestVersion: [number, number, number] | null = null;
  for (const candidate of candidates) {
    const version = parseNodeVersion(candidate.version);
    if (!version) {
      continue;
    }
    if (!bestVersion || compareParsedVersions(version, bestVersion) > 0) {
      best = candidate;
      bestVersion = version;
    }
  }
  return best;
}

function getNodeBinaryName(platform: NodeJS.Platform): string {
  return platform === "win32" ? "node.exe" : "node";
}

/**
 * Probes well-known install locations for a Node.js binary and returns the
 * newest one found (newest-wins avoids adopting a stray ancient binary when
 * a modern install exists elsewhere). Every check spawns the binary by
 * absolute path with no shell, so a corrupted PATH cannot break probing.
 */
export async function probeForNode(): Promise<NodeProbeResult | null> {
  const candidates = getNodeProbeCandidateDirs({
    platform: process.platform,
    env: process.env,
    homeDir: homedir(),
    listSubdirectories: defaultListSubdirectories,
  });

  const binaryName = getNodeBinaryName(process.platform);
  const existing = candidates.filter((candidate) =>
    existsSync(path.join(candidate.binDir, binaryName)),
  );
  if (existing.length === 0) {
    return null;
  }

  const results = await Promise.all(
    existing.map(async (candidate): Promise<NodeProbeResult | null> => {
      const nodePath = path.join(candidate.binDir, binaryName);
      const version = await getNodeVersionAtPath(nodePath);
      if (!version) {
        return null;
      }
      return {
        binDir: candidate.binDir,
        nodePath,
        version,
        origin: candidate.origin,
      };
    }),
  );

  const best = pickNewestNodeCandidate(
    results.filter((result): result is NodeProbeResult => result !== null),
  );
  if (best) {
    logger.info(
      `Probe found Node.js ${best.version} (${best.origin}) at ${best.nodePath}`,
    );
  }
  return best;
}

let cachedProbe: {
  result: NodeProbeResult | null;
  expiresAt: number;
} | null = null;
let inFlightProbe: Promise<NodeProbeResult | null> | null = null;

/**
 * Cached wrapper around {@link probeForNode}: the setup card polls status
 * while it is visible, and each probe spawns processes.
 */
export function probeForNodeCached(): Promise<NodeProbeResult | null> {
  if (cachedProbe && Date.now() < cachedProbe.expiresAt) {
    return Promise.resolve(cachedProbe.result);
  }
  if (!inFlightProbe) {
    inFlightProbe = probeForNode()
      .then((result) => {
        cachedProbe = {
          result,
          expiresAt: Date.now() + PROBE_CACHE_TTL_MS,
        };
        return result;
      })
      .finally(() => {
        inFlightProbe = null;
      });
  }
  return inFlightProbe;
}

export function clearNodeProbeCacheForTests(): void {
  cachedProbe = null;
  inFlightProbe = null;
}
