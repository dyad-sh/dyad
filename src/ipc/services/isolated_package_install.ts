import type { ChildProcess } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { glob } from "glob";
import { parse as parseYaml } from "yaml";

import { choosePackageManagerForApp } from "@/ipc/utils/package_manager_selection";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  PNPM_INSTALL_POLICY_ARGS,
} from "@/ipc/utils/socket_firewall";

export type IsolatedPackageManager = "npm" | "pnpm";

export interface PackageManagerResolution {
  packageManager: IsolatedPackageManager;
  sourceInstallPath: string;
}

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

async function matchesWorkspacePatterns(
  workspaceRoot: string,
  appPath: string,
  workspaces: readonly unknown[],
): Promise<boolean> {
  // These come straight out of a user-authored manifest, where `workspaces` is
  // whatever JSON or YAML happened to parse. A number or an object entry would
  // throw out of `startsWith` and abort the whole sandbox setup, when the right
  // answer is simply that the entry matches nothing.
  const patterns = workspaces.filter(
    (workspace): workspace is string => typeof workspace === "string",
  );
  const positivePatterns = patterns.filter(
    (workspace) => !workspace.startsWith("!"),
  );
  if (positivePatterns.length === 0) return false;
  const ignoredPatterns = patterns
    .filter((workspace) => workspace.startsWith("!"))
    .map((workspace) => workspace.slice(1));
  const matches = await glob(positivePatterns, {
    cwd: workspaceRoot,
    absolute: true,
    follow: false,
    ignore: ignoredPatterns,
  });
  const realAppPath = await fs.realpath(appPath);
  for (const match of matches) {
    const realMatch = await fs.realpath(match).catch(() => null);
    if (realMatch === realAppPath) return true;
  }
  return false;
}

interface WorkspaceGlobs {
  positive: string[];
  ignored: string[];
}

function splitWorkspacePatterns(collected: readonly unknown[]): WorkspaceGlobs {
  const patterns = collected.filter(
    (workspace): workspace is string => typeof workspace === "string",
  );
  return {
    positive: patterns.filter((workspace) => !workspace.startsWith("!")),
    ignored: patterns
      .filter((workspace) => workspace.startsWith("!"))
      .map((workspace) => workspace.slice(1)),
  };
}

/** `pnpm-workspace.yaml` `packages`, or null when there is no such manifest. */
async function readPnpmWorkspacePatterns(
  workspaceRoot: string,
): Promise<WorkspaceGlobs | null> {
  try {
    const parsed = parseYaml(
      await fs.readFile(
        path.join(workspaceRoot, "pnpm-workspace.yaml"),
        "utf8",
      ),
    ) as { packages?: unknown } | null;
    return Array.isArray(parsed?.packages)
      ? splitWorkspacePatterns(parsed.packages)
      : null;
  } catch {
    return null;
  }
}

/** `package.json` `workspaces`, or null when the manifest declares none. */
async function readNpmWorkspacePatterns(
  workspaceRoot: string,
): Promise<WorkspaceGlobs | null> {
  try {
    const packageJson = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    ) as { workspaces?: unknown[] | { packages?: unknown[] } };
    const workspaces = Array.isArray(packageJson.workspaces)
      ? packageJson.workspaces
      : packageJson.workspaces?.packages;
    return Array.isArray(workspaces)
      ? splitWorkspacePatterns(workspaces)
      : null;
  } catch {
    return null;
  }
}

/**
 * Whether `workspaceRoot` declares a pnpm workspace. The two manifests are NOT
 * interchangeable: npm cannot resolve members declared only in
 * `pnpm-workspace.yaml`, so the bootstrap has to know which one is in play
 * before choosing an invocation.
 */
export async function declaresPnpmWorkspace(
  workspaceRoot: string,
): Promise<boolean> {
  return (await readPnpmWorkspacePatterns(workspaceRoot)) !== null;
}

/** Whether `workspaceRoot` declares npm/yarn workspaces in its `package.json`. */
export async function declaresNpmWorkspaces(
  workspaceRoot: string,
): Promise<boolean> {
  return (await readNpmWorkspacePatterns(workspaceRoot)) !== null;
}

/**
 * Every package directory a single install at `workspaceRoot` would touch.
 *
 * Both package managers install *all* workspace members from the root and run
 * each member's lifecycle scripts, so a sibling package is as much a part of
 * this install as the app is — which makes its copied `.env` files a live
 * credential source the sandbox has to account for.
 *
 * Best-effort by design: an unreadable manifest or a glob that matches nothing
 * yields an empty list rather than failing the run, because the caller's own
 * directories are covered either way.
 */
export async function findWorkspacePackageDirectories(
  workspaceRoot: string,
): Promise<string[]> {
  // Each manifest is evaluated on its own and the results are UNIONED. Merging
  // the pattern lists first would let a `!` negation from one manifest hide a
  // member the other manifest still declares — and whichever manager runs, it
  // installs that member and runs its lifecycle scripts, so a hidden member is
  // a live credential source nothing withholds.
  const manifests = await Promise.all([
    readPnpmWorkspacePatterns(workspaceRoot),
    readNpmWorkspacePatterns(workspaceRoot),
  ]);
  const matches = new Set<string>();
  for (const manifest of manifests) {
    if (!manifest || manifest.positive.length === 0) continue;
    try {
      for (const match of await glob(manifest.positive, {
        cwd: workspaceRoot,
        absolute: true,
        follow: false,
        ignore: manifest.ignored,
      })) {
        matches.add(match);
      }
    } catch {
      // A malformed glob in one manifest must not lose the other's members.
      continue;
    }
  }
  const directories: string[] = [];
  for (const match of matches) {
    if (match === workspaceRoot) continue;
    // A member is a directory with its own manifest. The globs are authored for
    // package managers, so they can also match plain files or empty shells.
    const isPackage = await fs
      .stat(path.join(match, "package.json"))
      .then((stat) => stat.isFile())
      .catch(() => false);
    if (isPackage) directories.push(match);
  }
  return directories;
}

async function isNpmWorkspaceMember(
  workspaceRoot: string,
  appPath: string,
): Promise<boolean> {
  let packageJson: {
    workspaces?: unknown[] | { packages?: unknown[] };
  };
  try {
    packageJson = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    ) as typeof packageJson;
  } catch {
    return false;
  }
  const workspaces = Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : packageJson.workspaces?.packages;
  return Array.isArray(workspaces) && workspaces.length > 0
    ? matchesWorkspacePatterns(workspaceRoot, appPath, workspaces)
    : false;
}

async function isPnpmWorkspaceMember(
  workspaceRoot: string,
  appPath: string,
): Promise<boolean> {
  try {
    const parsed = parseYaml(
      await fs.readFile(
        path.join(workspaceRoot, "pnpm-workspace.yaml"),
        "utf8",
      ),
    ) as { packages?: unknown } | null;
    const workspaces = Array.isArray(parsed?.packages) ? parsed.packages : [];
    return workspaces.length > 0
      ? matchesWorkspacePatterns(workspaceRoot, appPath, workspaces)
      : false;
  } catch {
    return false;
  }
}

export async function findPackageManagerRoot(
  appPath: string,
  repoRoot: string,
): Promise<string> {
  let candidate = path.dirname(appPath);
  while (pathIsInside(repoRoot, candidate)) {
    if (
      (await isPnpmWorkspaceMember(candidate, appPath)) ||
      (await isNpmWorkspaceMember(candidate, appPath))
    ) {
      return candidate;
    }
    if (candidate === repoRoot) break;
    candidate = path.dirname(candidate);
  }
  return appPath;
}

export async function resolvePackageManager(
  appPath: string,
  repoRoot = appPath,
): Promise<PackageManagerResolution> {
  const support = await getPnpmMinimumReleaseAgeSupport();
  const sourceInstallPath = await findPackageManagerRoot(appPath, repoRoot);
  return {
    packageManager: choosePackageManagerForApp(
      sourceInstallPath,
      support.available,
    ),
    sourceInstallPath,
  };
}

export function getCleanInstallArgs({
  packageManager,
  hasLockfile,
}: {
  packageManager: IsolatedPackageManager;
  hasLockfile: boolean;
}): string[] {
  if (packageManager === "pnpm") {
    return [
      ...PNPM_INSTALL_POLICY_ARGS,
      "install",
      ...(hasLockfile ? ["--frozen-lockfile"] : []),
      "--prefer-offline",
    ];
  }
  return [
    hasLockfile ? "ci" : "install",
    "--legacy-peer-deps",
    "--prefer-offline",
  ];
}

/**
 * A frozen install refusing because the lockfile and `package.json` disagree.
 *
 * npm reports `EUSAGE` with "can only install packages when your package.json
 * and package-lock.json ... are in sync"; pnpm reports `ERR_PNPM_OUTDATED_LOCKFILE`.
 * Both are distinguishable from a genuine dependency failure, which is what
 * makes falling back safe: nothing else is retried.
 */
const LOCKFILE_OUT_OF_SYNC_PATTERN =
  /ERR_PNPM_OUTDATED_LOCKFILE|frozen-lockfile|can only install packages when your package\.json|Missing: .+ from lock file|lockfile is not up to date/i;

export async function runCleanPackageInstall({
  cwd,
  packageManager,
  env = getPackageManagerCommandEnv(),
  signal,
  timeoutMs,
  onOutput,
  onProcess,
}: {
  cwd: string;
  packageManager: IsolatedPackageManager;
  /**
   * The environment the install and its lifecycle scripts run under. Defaults
   * to the package-manager environment every other caller wants; the sandbox
   * passes one with the inherited database credentials removed.
   */
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
  timeoutMs: number;
  onOutput?: (chunk: string) => void;
  /**
   * Hands the install child to the caller so it can be terminated by something
   * other than `signal`. Opt-in: the build snapshot shares this helper and has
   * its own lifecycle, so only the caller that owns a quit-time kill registers
   * one.
   */
  onProcess?: (child: ChildProcess) => void;
}) {
  const lockfileName =
    packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  const hasLockfile = await fs
    .stat(path.join(cwd, lockfileName))
    .then((stat) => stat.isFile())
    .catch(() => false);
  const startedAt = Date.now();
  const spawnInstall = (frozen: boolean, budgetMs: number) =>
    spawnStreaming({
      command: packageManager,
      args: getCleanInstallArgs({ packageManager, hasLockfile: frozen }),
      cwd,
      env,
      signal,
      timeoutMs: budgetMs,
      onOutput,
      onProcess,
    });

  const result = await spawnInstall(hasLockfile, timeoutMs);
  if (
    !hasLockfile ||
    result.code === 0 ||
    result.aborted ||
    result.timedOut ||
    !LOCKFILE_OUT_OF_SYNC_PATTERN.test(`${result.stderr}\n${result.stdout}`)
  ) {
    return { ...result, hasLockfile };
  }

  // The lockfile and `package.json` disagree. This is a routine state in a
  // Dyad app — the agent edits `package.json` and the preview's tolerant
  // `npm install --legacy-peer-deps` silently repairs it — so a frozen install
  // being STRICTER than the preview the sandbox is meant to reproduce is a
  // defect, not extra safety: it would fail every test run for an app that
  // starts and runs fine.
  //
  // Per **Principle #5: Bridge, Don't Replace** ("Dyad runs `npm install` ...
  // but doesn't manage node_modules or lock files beyond what the user
  // configures"), the fallback resolves the tree the way the user's own
  // preview does rather than making Dyad the owner of their lockfile. Announced
  // rather than silent, per **Principle #4: Transparent Over Magical**, so the
  // drift is visible in the setup output where the user can act on it.
  onOutput?.(
    `\nYour lockfile is out of sync with package.json, so the strict install was refused. Retrying the way your preview installs (${packageManager === "pnpm" ? "pnpm install" : "npm install --legacy-peer-deps"}); commit an updated lockfile to keep test runs reproducible.\n`,
  );
  const remainingMs = Math.max(1, timeoutMs - (Date.now() - startedAt));
  const retried = await spawnInstall(false, remainingMs);
  return { ...retried, hasLockfile: false };
}
