import fs from "node:fs";

import { db } from "@/db";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { appFolderNameWithSuffix } from "@/shared/app_names";

// Bound collision probing so a pathological database/filesystem state cannot
// keep a user action running indefinitely. Hitting this production-safety cap
// is reported as an explicit Conflict rather than silently choosing a folder.
export const MAX_COLLISION_SUFFIX_ATTEMPTS = 1000;

/**
 * Resolves a display name to one not taken by another app, appending a
 * numeric suffix on collision ("Todo App" -> "Todo App 2"). `excludeAppId`
 * keeps the app being renamed from conflicting with itself, so re-running
 * the same rename is idempotent.
 */
export async function resolveUniqueAppName(
  desiredName: string,
  options?: { excludeAppId?: number },
): Promise<string> {
  const allApps = await db.query.apps.findMany();
  const takenNames = new Set(
    allApps
      .filter((app) => app.id !== options?.excludeAppId)
      .map((app) => app.name),
  );
  if (!takenNames.has(desiredName)) {
    return desiredName;
  }
  for (let suffix = 2; suffix <= MAX_COLLISION_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = `${desiredName} ${suffix}`;
    if (!takenNames.has(candidate)) {
      return candidate;
    }
  }
  throw new DyadError(
    `Could not find an available app name for "${desiredName}" after ${MAX_COLLISION_SUFFIX_ATTEMPTS} attempts.`,
    DyadErrorKind.Conflict,
  );
}

/**
 * Resolves a folder name to one whose path is free, appending a numeric
 * suffix on collision ("my-app" -> "my-app-2"). Conflicts are probed against
 * both the database (all app paths, case-insensitively, since macOS and
 * Windows filesystems are case-insensitive by default) and the filesystem.
 *
 * `excludeAppId` skips the renamed app's own database row, and its current
 * folder is also allowed on disk so a rename to the same folder is a no-op.
 * `resolveCandidate` overrides how a folder name maps to an absolute path
 * (used by rename for apps stored at an absolute custom location).
 */
export async function resolveUniqueFolderName(
  baseFolderName: string,
  options?: {
    excludeAppId?: number;
    resolveCandidate?: (folderName: string) => string;
  },
): Promise<string> {
  const resolveCandidate = options?.resolveCandidate ?? getDyadAppPath;
  const allApps = await db.query.apps.findMany();
  const takenPaths = new Set<string>();
  let ownPath: string | undefined;
  for (const app of allApps) {
    const resolved = getDyadAppPath(app.path).toLowerCase();
    if (app.id === options?.excludeAppId) {
      ownPath = resolved;
    } else {
      takenPaths.add(resolved);
    }
  }

  for (let suffix = 1; suffix <= MAX_COLLISION_SUFFIX_ATTEMPTS; suffix++) {
    const candidate = appFolderNameWithSuffix(baseFolderName, suffix);
    const resolvedPath = resolveCandidate(candidate);
    const comparablePath = resolvedPath.toLowerCase();
    if (takenPaths.has(comparablePath)) {
      continue;
    }
    if (comparablePath !== ownPath && fs.existsSync(resolvedPath)) {
      continue;
    }
    return candidate;
  }
  throw new DyadError(
    `Could not find an available app folder for "${baseFolderName}" after ${MAX_COLLISION_SUFFIX_ATTEMPTS} attempts.`,
    DyadErrorKind.Conflict,
  );
}
