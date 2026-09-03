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
  const result = await spawnStreaming({
    command: packageManager,
    args: getCleanInstallArgs({ packageManager, hasLockfile }),
    cwd,
    env,
    signal,
    timeoutMs,
    onOutput,
    onProcess,
  });
  return { ...result, hasLockfile };
}
