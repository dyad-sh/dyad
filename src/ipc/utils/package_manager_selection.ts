import fs from "node:fs";
import path from "node:path";

import type { PackageManager } from "@/ipc/utils/socket_firewall";

export type PackageManagerSignal = {
  packageManagerField: string | null;
  hasPnpmLockfile: boolean;
  hasNpmLockfile: boolean;
  hasPnpmNodeModules: boolean;
  hasNpmNodeModules: boolean;
};

function fileExists(filePath: string): boolean {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function readPackageManagerField(appPath: string): string | null {
  try {
    const packageJsonPath = path.join(appPath, "package.json");
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
    return typeof packageJson.packageManager === "string"
      ? packageJson.packageManager
      : null;
  } catch {
    return null;
  }
}

export function getPackageManagerSignal(appPath: string): PackageManagerSignal {
  return {
    packageManagerField: readPackageManagerField(appPath),
    hasPnpmLockfile: fileExists(path.join(appPath, "pnpm-lock.yaml")),
    hasNpmLockfile: fileExists(path.join(appPath, "package-lock.json")),
    hasPnpmNodeModules: fileExists(path.join(appPath, "node_modules", ".pnpm")),
    hasNpmNodeModules: fileExists(
      path.join(appPath, "node_modules", ".package-lock.json"),
    ),
  };
}

/**
 * Chooses the package manager for Dyad-managed commands (run, add-dependency).
 *
 * Precedence is intentionally explicit:
 * 1. package.json packageManager="pnpm@..." means the project asked for pnpm;
 *    if pnpm is unavailable, use npm as the temporary fallback for this run.
 * 2. package.json packageManager="npm@..." means the project asked for npm.
 * 3. Existing node_modules layout wins before lockfile ties to avoid suddenly
 *    running pnpm on top of an npm-installed dependency tree.
 * 4. A lone pnpm-lock.yaml means pnpm.
 * 5. A lone package-lock.json means npm.
 * 6. If both lockfiles exist, prefer pnpm. This is our tie-breaker for
 *    migrated apps, where package-lock.json may be kept around conservatively.
 * 7. With no project signal, prefer pnpm when it is available so new/ambiguous
 *    apps get pnpm's lower disk usage; otherwise fall back to npm.
 */
export function choosePackageManagerFromSignal({
  signal,
  pnpmAvailable,
}: {
  signal: PackageManagerSignal;
  pnpmAvailable: boolean;
}): PackageManager {
  const choosePnpmWhenAvailable = () => (pnpmAvailable ? "pnpm" : "npm");

  if (signal.packageManagerField?.startsWith("pnpm@")) {
    return choosePnpmWhenAvailable();
  }
  if (signal.packageManagerField?.startsWith("npm@")) {
    return "npm";
  }
  if (signal.hasPnpmNodeModules) {
    return choosePnpmWhenAvailable();
  }
  if (signal.hasNpmNodeModules) {
    return "npm";
  }
  if (signal.hasPnpmLockfile && !signal.hasNpmLockfile) {
    return choosePnpmWhenAvailable();
  }
  if (signal.hasNpmLockfile && !signal.hasPnpmLockfile) {
    return "npm";
  }
  if (signal.hasPnpmLockfile && signal.hasNpmLockfile) {
    return choosePnpmWhenAvailable();
  }
  return pnpmAvailable ? "pnpm" : "npm";
}

/**
 * Whether the app's own signals point at pnpm (ignoring whether pnpm is
 * currently installed). Use this to decide if pnpm-specific warnings are
 * relevant to the app, including while it temporarily falls back to npm.
 */
export function signalPrefersPnpm(signal: PackageManagerSignal): boolean {
  return (
    choosePackageManagerFromSignal({ signal, pnpmAvailable: true }) === "pnpm"
  );
}

export function choosePackageManagerForApp(
  appPath: string,
  pnpmAvailable: boolean,
): PackageManager {
  return choosePackageManagerFromSignal({
    signal: getPackageManagerSignal(appPath),
    pnpmAvailable,
  });
}
