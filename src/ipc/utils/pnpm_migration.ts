import fs from "node:fs";
import path from "node:path";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { gitAdd, gitCommit } from "@/ipc/utils/git_utils";
import {
  getPnpmMinimumReleaseAgeSupport,
  PNPM_GLOBAL_INSTALL_PACKAGE,
  PNPM_INSTALL_POLICY_ARGS,
} from "@/ipc/utils/socket_firewall";
import { simpleSpawnWithDeniedPnpmBuildSelfHeal } from "@/ipc/utils/app_upgrade_utils";
import {
  recordAndReportDeniedPnpmBuilds,
  resolvePnpmIgnoredBuilds,
} from "@/ipc/utils/pnpm_denied_builds";
import {
  getPackageManagerSignal,
  signalPrefersPnpm,
} from "@/ipc/utils/package_manager_selection";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";

const logger = log.scope("pnpm_migration");

// pnpm 9, 10, and 11 all write lockfileVersion 9.0, so a lockfile below this
// is the one case where running the managed pnpm rewrites the lockfile into a
// format the pinned/older pnpm cannot read (breaking the user's CI/deploys).
const COMPATIBLE_PNPM_LOCKFILE_MAJOR = 9;
// Pins at or below pnpm 8 write pre-9.0 lockfiles.
const LAST_INCOMPATIBLE_PNPM_MAJOR = 8;

export function getManagedPnpmMajorVersion(): number {
  const match = PNPM_GLOBAL_INSTALL_PACKAGE.match(/latest-(\d+)$/);
  if (!match) {
    throw new Error(
      `Cannot derive pnpm major version from "${PNPM_GLOBAL_INSTALL_PACKAGE}"`,
    );
  }
  return Number(match[1]);
}

export function parsePnpmLockfileVersion(content: string): number | null {
  // Formats across pnpm majors: `lockfileVersion: 5.4` (number),
  // `lockfileVersion: '6.0'` / `lockfileVersion: "9.0"` (quoted string).
  const match = content.match(/^lockfileVersion:\s*['"]?(\d+(?:\.\d+)?)/m);
  if (!match) {
    return null;
  }
  const version = Number.parseFloat(match[1]);
  return Number.isFinite(version) ? version : null;
}

export function parsePinnedPnpmMajorVersion(
  packageManagerField: string | null,
): number | null {
  if (!packageManagerField) {
    return null;
  }
  const match = packageManagerField.match(/^pnpm@(\d+)/);
  if (!match) {
    return null;
  }
  return Number(match[1]);
}

function readPnpmLockfileVersion(appPath: string): number | null {
  try {
    const content = fs.readFileSync(
      path.join(appPath, "pnpm-lock.yaml"),
      "utf8",
    );
    return parsePnpmLockfileVersion(content);
  } catch {
    return null;
  }
}

/**
 * True when running the managed pnpm against this app leaves the repo in a
 * state the app's own pin/lockfile-era pnpm cannot read: a pre-9.0 lockfile
 * (which the managed pnpm rewrites incompatibly on install) or a
 * `packageManager` pin at or below pnpm 8 (whose corepack/CI installs cannot
 * read the 9.0 lockfile Dyad produces).
 */
export function isPnpmVersionMigrationNeeded(appPath: string): boolean {
  const signal = getPackageManagerSignal(appPath);
  if (!signalPrefersPnpm(signal)) {
    return false;
  }

  const lockfileVersion = readPnpmLockfileVersion(appPath);
  if (
    lockfileVersion !== null &&
    lockfileVersion < COMPATIBLE_PNPM_LOCKFILE_MAJOR
  ) {
    return true;
  }

  const pinnedMajor = parsePinnedPnpmMajorVersion(signal.packageManagerField);
  return pinnedMajor !== null && pinnedMajor <= LAST_INCOMPATIBLE_PNPM_MAJOR;
}

async function updatePackageManagerPin(
  appPath: string,
  pnpmVersion: string,
): Promise<void> {
  const packageJsonPath = path.join(appPath, "package.json");
  const packageJson = JSON.parse(
    await fs.promises.readFile(packageJsonPath, "utf8"),
  );
  packageJson.packageManager = `pnpm@${pnpmVersion}`;
  await fs.promises.writeFile(
    packageJsonPath,
    `${JSON.stringify(packageJson, null, 2)}\n`,
  );
}

/**
 * Migrates the app to the Dyad-managed pnpm in one visible step: updates the
 * `packageManager` pin to the version Dyad actually runs, reinstalls so the
 * lockfile is rewritten to the matching format, and commits both together so
 * the repo's self-description, lockfile, and CI/deploy behavior agree.
 */
export async function applyPnpmVersionMigration({
  appPath,
}: {
  appPath: string;
}): Promise<void> {
  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
  if (!pnpmSupport.available || !pnpmSupport.version) {
    throw new DyadError(
      "pnpm is not available, so the project cannot be migrated. Restart Dyad and try again.",
      DyadErrorKind.External,
    );
  }

  const previousLockfileVersion = readPnpmLockfileVersion(appPath);
  await updatePackageManagerPin(appPath, pnpmSupport.version);

  await simpleSpawnWithDeniedPnpmBuildSelfHeal({
    command: `pnpm ${PNPM_INSTALL_POLICY_ARGS.join(" ")} install`,
    cwd: appPath,
    successMessage: "Reinstalled dependencies with the Dyad-managed pnpm",
    errorPrefix: "Failed to reinstall dependencies with pnpm",
  });

  // Old-lockfile apps commonly carry unlisted build-script deps; record any
  // builds this install skipped so plain `pnpm install` stays green outside
  // Dyad (this also commits pnpm-workspace.yaml when it changes).
  const ignoredBuilds = await resolvePnpmIgnoredBuilds(appPath);
  await recordAndReportDeniedPnpmBuilds({
    appPath,
    ignoredBuilds,
    source: "app-upgrade",
  });

  const migrationMajor = getManagedPnpmMajorVersion();
  try {
    await gitAdd({ path: appPath, filepath: "package.json" });
    await gitAdd({ path: appPath, filepath: "pnpm-lock.yaml" });
    await gitCommit({
      path: appPath,
      message: `[dyad] migrate to pnpm ${migrationMajor}`,
    });
  } catch (error) {
    logger.warn("Failed to commit pnpm migration changes:", error);
    throw new DyadError(
      "The migration ran but the changes could not be committed. Please commit package.json and pnpm-lock.yaml manually.",
      DyadErrorKind.External,
    );
  }

  sendTelemetryEvent("pnpm:version-migration-applied", {
    fromLockfileVersion: previousLockfileVersion,
    toPnpmVersion: pnpmSupport.version,
  });
}
