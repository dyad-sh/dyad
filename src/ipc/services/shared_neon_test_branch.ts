import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { withLock } from "../utils/lock_utils";
import {
  createTempTestBranch,
  markAndDeleteTempTestBranch,
  trackedTestBranchId,
  type TempTestBranch,
} from "../utils/neon_test_branch";

type AppRow = typeof apps.$inferSelect;
type Entry = {
  phase: "ready" | "deleting";
  branch: TempTestBranch;
  identity: string;
  owners: Set<symbol>;
};
const entries = new Map<number, Entry>();

/**
 * The string-keyed mutex is the linearization boundary for acquire/release,
 * including remote creation/deletion. The durable cleanup-only app marker is
 * written by createTempTestBranch before provisioning. Secrets and live owners
 * are memory-only; after a crash the existing startup sweep retires the branch.
 * No new owner can arrive between the last-owner check and deletion.
 */
export async function acquireSharedNeonTestBranch(
  app: AppRow,
  appPath: string,
  initialize: (branch: TempTestBranch) => Promise<void>,
) {
  const lock = `e2e-neon-branch:${app.id}`;
  const owner = Symbol("test-run");
  const identity = JSON.stringify([
    app.neonProjectId,
    app.neonActiveBranchId ??
      app.neonDevelopmentBranchId ??
      app.neonPreviewBranchId,
  ]);
  const entry = await withLock(lock, async () => {
    const current = entries.get(app.id);
    if (current) {
      if (current.phase !== "ready" || current.identity !== identity)
        throw new DyadError(
          "The shared test database belongs to a different Neon configuration.",
          DyadErrorKind.Conflict,
        );
      current.owners.add(owner);
      return current;
    }
    const fresh = await db.query.apps.findFirst({ where: eq(apps.id, app.id) });
    if (!fresh)
      throw new DyadError("App no longer exists", DyadErrorKind.NotFound);
    let branch: TempTestBranch | undefined;
    try {
      branch = await createTempTestBranch(fresh, {
        cleanupOnly: true,
        appPathOverride: appPath,
      });
      // Clear parent data exactly once, before any consumer sees this branch.
      await initialize(branch);
    } catch (error) {
      const marker = branch?.branchId ?? (await trackedTestBranchId(app.id));
      if (marker && marker !== fresh.neonTestBranchId)
        await markAndDeleteTempTestBranch(fresh, marker);
      throw error;
    }
    const created: Entry = {
      phase: "ready",
      identity,
      branch,
      owners: new Set([owner]),
    };
    entries.set(app.id, created);
    return created;
  });
  let released: Promise<boolean> | undefined;
  return {
    branch: entry.branch,
    release: () =>
      (released ??= withLock(lock, async () => {
        if (entries.get(app.id) !== entry || !entry.owners.delete(owner))
          return true;
        if (entry.owners.size) return true;
        entry.phase = "deleting";
        try {
          return await markAndDeleteTempTestBranch(app, entry.branch.branchId);
        } finally {
          // A failed deletion stays durably tracked; the next create retries it
          // before replacing the marker, rather than reusing partially cleaned data.
          entries.delete(app.id);
        }
      })),
  };
}
