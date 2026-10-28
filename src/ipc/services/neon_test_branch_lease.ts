import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getNeonErrorMessage } from "@/neon_admin/neon_errors";
import type { NeonBranchLimitStatus } from "@/shared/neon_branch_limit";
import { abortable } from "../utils/abortable";
import { withLock } from "../utils/lock_utils";
import {
  createTempTestBranch,
  markAndDeleteTempTestBranch,
  trackedRunTestBranchId,
} from "../utils/neon_test_branch";

type AppRow = typeof apps.$inferSelect;

/** Only an explicit branch-count rejection can become a capacity wait. */
export function isNeonBranchCapacityError(error: unknown): boolean {
  const response = (
    error as { response?: { status?: number; data?: { code?: string } } } | null
  )?.response;
  if (!response || ![400, 403, 409, 422].includes(response.status ?? 0))
    return false;
  if (response.data?.code === "BRANCHES_LIMIT_EXCEEDED") return true;
  // Some API versions omit the structured code. Do not classify storage,
  // compute, auth, or request rate limits as branch capacity.
  const message = getNeonErrorMessage(error);
  return (
    /\bbranches limit exceeded\b/i.test(message) ||
    /\b(?:maximum|max) (?:number of )?branches\b.*\b(?:reached|exceeded)\b/i.test(
      message,
    )
  );
}

/**
 * Project-scoped admission uses the existing FIFO mutex, rather than a second
 * run scheduler. Its callback owns creation through compensation; release is
 * deliberately outside that mutex so a capacity waiter cannot block teardown.
 * Live promises are a settlement registry, not a capacity estimate: every retry
 * asks Neon again. Durable records are owned by createTempTestBranch.
 */
const active = new Map<string, Set<Promise<void>>>();
// Observe every admission, including callers behind the FIFO lock. This does
// not schedule work: it propagates a confirmed capacity wait to its followers.
type PendingBranchAdmission = { waiting: boolean; notifyWaiting: () => void };
const pendingAdmissions = new Map<string, Set<PendingBranchAdmission>>();

export function acquireNeonTestBranch(
  app: AppRow,
  appPath: string,
  ownerId: string,
  {
    signal,
    onCapacity,
  }: {
    signal?: AbortSignal;
    onCapacity?: (status: NeonBranchLimitStatus | undefined) => void;
  },
) {
  const projectId = app.neonProjectId!;
  return withBranchAdmission(projectId, signal, onCapacity, async () => {
    for (;;) {
      signal?.throwIfAborted();
      const fresh = await db.query.apps.findFirst({
        where: eq(apps.id, app.id),
      });
      if (!fresh)
        throw new DyadError("App no longer exists", DyadErrorKind.NotFound);
      signal?.throwIfAborted();
      const ownersAtAttempt = [...(active.get(projectId) ?? [])];
      try {
        const branch = await createTempTestBranch(fresh, {
          cleanupOnly: true,
          appPathOverride: appPath,
          ownerId,
        });
        signal?.throwIfAborted();
        onCapacity?.(undefined);
        let settled!: () => void;
        const done = new Promise<void>((resolve) => {
          settled = resolve;
        });
        const owners = active.get(projectId) ?? new Set<Promise<void>>();
        owners.add(done);
        active.set(projectId, owners);
        let released: Promise<boolean> | undefined;
        return {
          branch,
          release: () =>
            (released ??= (async () => {
              try {
                return await markAndDeleteTempTestBranch(app, branch.branchId);
              } finally {
                owners.delete(done);
                if (!owners.size) active.delete(projectId);
                settled();
              }
            })()),
        };
      } catch (error) {
        // Creation can fail after persisting the branch (e.g. Auth setup).
        // Retire only this run's branch, never another run's recovery record.
        const branchId = await trackedRunTestBranchId(ownerId);
        if (branchId) {
          await markAndDeleteTempTestBranch(app, branchId);
          throw error;
        }
        signal?.throwIfAborted();
        const owners = active.get(projectId);
        if (!isNeonBranchCapacityError(error)) throw error;
        // A run can finish while the rejected request (or recovery lookup) is
        // in flight. Retry against that changed capacity before declaring that
        // no run can help; waiting only on the remaining owners misses this edge.
        if (ownersAtAttempt.some((owner) => !owners?.has(owner))) continue;
        if (!owners?.size) {
          onCapacity?.("blocked");
          throw new DyadError(
            "Your Neon plan's branch limit was reached, and no active test run can free a branch. Delete an unused branch in Neon or upgrade your plan, then run the tests again.",
            DyadErrorKind.Precondition,
            { cause: error },
          );
        }
        for (const admission of pendingAdmissions.get(projectId) ?? [])
          admission.notifyWaiting();
        // No timer/poll loop: wait until a live run finishes remote cleanup.
        // Failed deletion wakes us too, but never implies capacity is free.
        await abortable(Promise.race(owners), signal);
      }
    }
  });
}

/** Cancel mutex admission immediately, but never detach an in-flight mutation. */
function withBranchAdmission<T>(
  projectId: string,
  signal: AbortSignal | undefined,
  onCapacity: ((status: NeonBranchLimitStatus | undefined) => void) | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const admissions =
    pendingAdmissions.get(projectId) ?? new Set<PendingBranchAdmission>();
  const admission = {
    waiting: false,
    notifyWaiting: () => {
      if (admission.waiting || signal?.aborted) return;
      admission.waiting = true;
      onCapacity?.("waiting");
    },
  };
  const alreadyWaiting = [...admissions].some((entry) => entry.waiting);
  admissions.add(admission);
  pendingAdmissions.set(projectId, admissions);
  if (alreadyWaiting) admission.notifyWaiting();
  return new Promise<T>((resolve, reject) => {
    let entered = false;
    const onAbort = () => {
      if (!entered) reject(signal?.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) onAbort();
    void withLock(`neon-test-branch-admission:${projectId}`, async () => {
      entered = true;
      signal?.removeEventListener("abort", onAbort);
      signal?.throwIfAborted();
      return work();
    }).then(resolve, reject);
  }).finally(() => {
    admissions.delete(admission);
    if (!admissions.size) pendingAdmissions.delete(projectId);
  });
}
