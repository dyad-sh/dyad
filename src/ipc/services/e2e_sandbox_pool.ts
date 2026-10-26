import { promises as fs } from "node:fs";
import path from "node:path";
import { readSettings } from "@/main/settings";
import { getUserDataPath } from "@/paths/paths";
import { DEFAULT_MAX_REUSABLE_TEST_SANDBOXES } from "@/shared/settings_defaults";
import { withLock } from "../utils/lock_utils";
import {
  clearGitOverlayWorkspace,
  createGitOverlayWorkspace,
  markGitOverlayWorkspacePool,
  readGitOverlayWorkspaceMarker,
  removeGitOverlayWorkspace,
  type GitOverlayWorkspaceOptions,
} from "./git_overlay_workspace";

type Entry = {
  path: string;
  appId: number;
  state: "idle" | "leased" | "cleaning" | "quarantined";
};
const entries = new Map<string, Entry>();
const initializedRoots = new Set<string>();
const LOCK = "e2e-sandbox-pool";
const limit = () =>
  readSettings().maxReusableTestSandboxes ??
  DEFAULT_MAX_REUSABLE_TEST_SANDBOXES;

// All transitions (including disk markers) are serialized. A leased/cleaning
// entry counts against retention. Overflow is a property of the lease, so it
// cannot become retained just because a different run finishes first.
async function initialize(root: string) {
  if (initializedRoots.has(root)) return;
  await fs.mkdir(root, { recursive: true });
  for (const dir of await fs.readdir(root, { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const candidate = path.join(root, dir.name);
    const marker = await readGitOverlayWorkspaceMarker(candidate);
    if (marker?.purpose === "e2e-test" && marker.pool?.state === "idle")
      entries.set(candidate, {
        path: candidate,
        appId: marker.pool.appId,
        state: "idle",
      });
  }
  initializedRoots.add(root);
}

async function prune() {
  for (const entry of entries.values()) {
    if (entries.size <= limit()) break;
    if (entry.state !== "idle") continue;
    entry.state = "cleaning";
    try {
      await removeGitOverlayWorkspace(entry.path);
      entries.delete(entry.path);
    } catch (error) {
      entry.state = "quarantined";
      throw error;
    }
  }
}

export function acquireE2eSandbox(
  appId: number,
  options: GitOverlayWorkspaceOptions,
) {
  return withLock(LOCK, async () => {
    await initialize(options.scratchRoot);
    await prune();
    options.signal?.throwIfAborted();
    const idle =
      [...entries.values()].find(
        (entry) => entry.state === "idle" && entry.appId === appId,
      ) ?? [...entries.values()].find((entry) => entry.state === "idle");
    let reusePath: string | undefined;
    if (idle) {
      idle.state = "leased";
      try {
        const marker = await readGitOverlayWorkspaceMarker(idle.path);
        // Reuse paths only in the same app/repository. Recycle incompatible idle
        // entries instead of letting old apps permanently occupy the pool.
        const target = await fs.realpath(options.sourceTargetPath);
        const relative = marker && path.relative(marker.sourceRepoPath, target);
        if (
          idle.appId === appId &&
          marker &&
          relative !== undefined &&
          relative !== null &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative) &&
          !marker.submoduleWorktrees.length
        ) {
          reusePath = idle.path;
          await markGitOverlayWorkspacePool(idle.path, appId, "leased");
        } else {
          await removeGitOverlayWorkspace(idle.path);
          entries.delete(idle.path);
        }
      } catch (error) {
        idle.state = "quarantined";
        throw error;
      }
    }
    const retained = !!reusePath || entries.size < limit();
    let snapshot;
    try {
      snapshot = await createGitOverlayWorkspace({ ...options, reusePath });
    } catch (error) {
      if (reusePath) {
        const entry = entries.get(reusePath);
        if (!(await readGitOverlayWorkspaceMarker(reusePath)))
          entries.delete(reusePath);
        else if (entry) entry.state = "quarantined";
      }
      throw error;
    }
    const entry: Entry = {
      path: snapshot.worktreePath,
      appId,
      state: "leased",
    };
    if (retained) {
      entries.set(entry.path, entry);
      try {
        await markGitOverlayWorkspacePool(entry.path, appId, "leased");
      } catch (error) {
        entry.state = "quarantined";
        try {
          await removeGitOverlayWorkspace(entry.path);
          entries.delete(entry.path);
        } catch {
          /* Keep recovery marker. */
        }
        throw error;
      }
    }
    let released: Promise<void> | undefined;
    return {
      snapshot,
      reused: !!reusePath,
      retained,
      release: () =>
        (released ??= withLock(LOCK, async () => {
          entry.state = "cleaning";
          try {
            const marker = await readGitOverlayWorkspaceMarker(entry.path);
            if (
              !retained ||
              entries.size > limit() ||
              marker?.submoduleWorktrees.length
            ) {
              await removeGitOverlayWorkspace(
                entry.path,
                snapshot.sourceRepoPath,
              );
              entries.delete(entry.path);
            } else {
              await clearGitOverlayWorkspace(entry.path);
              await markGitOverlayWorkspacePool(entry.path, appId, "idle");
              entry.state = "idle";
            }
            await prune();
          } catch (error) {
            entry.state = "quarantined";
            throw error;
          }
        })),
    };
  });
}

export function reconcileE2eSandboxPool(
  root: string,
  knownApps?: ReadonlySet<number>,
) {
  return withLock(LOCK, async () => {
    await initialize(root);
    for (const entry of entries.values()) {
      if (entry.state !== "idle" || !knownApps || knownApps.has(entry.appId))
        continue;
      await removeGitOverlayWorkspace(entry.path);
      entries.delete(entry.path);
    }
    await prune();
  });
}

export function isRetainedE2eSandbox(worktreePath: string) {
  return entries.has(worktreePath);
}

/** Called after app deletion has fenced and drained test admission. */
export function removeE2eSandboxesForApp(appId: number) {
  return withLock(LOCK, async () => {
    const root = path.join(getUserDataPath(), "test-sandboxes");
    await initialize(await fs.realpath(root).catch(() => root));
    for (const entry of entries.values()) {
      if (entry.appId !== appId) continue;
      if (entry.state === "leased" || entry.state === "cleaning")
        throw new Error("A test sandbox is still owned.");
      // Quarantined entries failed reset/disposal after their processes stopped.
      // App deletion may remove them, but they must never be leased again.
      await removeGitOverlayWorkspace(entry.path);
      entries.delete(entry.path);
    }
  });
}

export async function refreshE2eSandboxRetention() {
  const root = path.join(getUserDataPath(), "test-sandboxes");
  await reconcileE2eSandboxPool(await fs.realpath(root).catch(() => root));
}
