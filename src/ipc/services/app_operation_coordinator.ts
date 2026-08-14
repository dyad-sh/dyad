import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { assertNoActiveRecording } from "./recording_registry";

export const APP_OPERATION_RESOURCES = [
  "app-path", // The app row's path and the identity/location of its directory.
  "chat-content", // Messages within the app's chats.
  "chat-membership", // Which chats belong to the app.
  "media", // Uploaded, generated, and screenshot files in the media library.
  "metadata", // General app fields not owned by a more specific resource.
  "provider", // Supabase/Neon associations and provider lifecycle state.
  "repository", // Umbrella for Git refs plus the index and working tree.
  "repository-ref", // Git HEAD and refs, excluding index and working-tree files.
  "repository-worktree", // Git index and working-tree files.
  "runtime", // The preview process, port, proxy, and sandbox lifecycle.
  "runtime-config", // Environment/configuration consumed by the runtime.
  "test-files", // Test inputs, generated configuration, and test artifacts.
] as const;

export type AppOperationResource = (typeof APP_OPERATION_RESOURCES)[number];
export type AppOperationAccessMode = "read" | "write";

/**
 * A second `beginAppDeletion` for an app already being deleted.
 *
 * A named class rather than a bare `Error`, because the delete handler has to
 * recognise it to report "already being deleted" as a Precondition rather than
 * an unclassified product exception (`rules/dyad-errors.md`). Matching on the
 * message text coupled the two files through a string nothing checks.
 */
export class AppDeletionInProgressError extends Error {
  constructor(readonly appId: number) {
    super(`App ${appId} deletion is already in progress`);
    this.name = "AppDeletionInProgressError";
  }
}

export interface AppOperationAccess {
  resource: AppOperationResource;
  mode: AppOperationAccessMode;
}

export interface AppOperationRequest {
  appId: number;
  operation: string;
  resources: readonly (AppOperationResource | AppOperationAccess)[];
  /**
   * While this operation is active, later compatible work may pass an earlier
   * queued operation that is blocked exclusively by bypass-enabled active
   * operations. Intended for long-lived sessions: a working-tree writer queued
   * behind one must not turn that session into a transitive barrier for a ref
   * snapshot the session itself permits.
   *
   * Once the session releases, ordinary writer fairness resumes. A compatible
   * operation that already bypassed may finish first, but new readers cannot
   * continue bypassing the queued writer behind that ordinary operation.
   */
  allowCompatibleQueueBypass?: boolean;
  /**
   * Refuse this operation outright while a recording session holds the app,
   * instead of queueing behind it. Names the action in the imperative, e.g.
   * "delete a test".
   *
   * A session claims repository, provider, runtime, runtime-config and
   * test-files for its whole lifetime, and this queue has no timeout — so
   * anything taking one of those claims can sit on a spinner for the rest of
   * the 30-minute cap with nothing on screen saying why. Paths that can't
   * simply end the session (the recording IS what the user is doing) say so and
   * let them decide.
   *
   * Checked HERE rather than by the caller beforehand so the refusal and the
   * admission are one synchronous step. A caller-side check leaves a window in
   * which a recording starts between the two, and the operation queues behind
   * the session the check exists to avoid.
   */
  refuseWhenRecording?: string;
}

interface NormalizedAppOperationRequest {
  appId: number;
  operation: string;
  resources: readonly AppOperationAccess[];
  allowCompatibleQueueBypass?: boolean;
}

interface PendingOperation {
  request: NormalizedAppOperationRequest;
  execute: () => Promise<unknown>;
  resolve: (result: unknown) => void;
  reject: (error: unknown) => void;
}

interface AppOperationState {
  active: Set<PendingOperation>;
  queue: PendingOperation[];
  deletion?: {
    token: symbol;
    drainWaiters: Set<() => void>;
  };
}

export interface AppOperationDeletion {
  drain(): Promise<void>;
  runExclusive<Result>(operation: () => Promise<Result>): Promise<Result>;
  release(): void;
}

function normalizeResources(
  resources: AppOperationRequest["resources"],
): readonly AppOperationAccess[] {
  const normalized = new Map<AppOperationResource, AppOperationAccessMode>();
  for (const access of resources) {
    const resource = typeof access === "string" ? access : access.resource;
    const mode = typeof access === "string" ? "write" : access.mode;
    // `repository` remains the broad, backwards-compatible claim. Expanding
    // it here lets callers opt into the narrower ref/worktree domains without
    // auditing every existing repository operation at once.
    const expandedResources =
      resource === "repository"
        ? (["repository-ref", "repository-worktree"] as const)
        : ([resource] as const);
    for (const expandedResource of expandedResources) {
      const current = normalized.get(expandedResource);
      if (current === "write" || current === mode) continue;
      normalized.set(expandedResource, mode);
    }
  }
  return [...normalized.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([resource, mode]) => ({ resource, mode }));
}

function conflictingResources(
  left: NormalizedAppOperationRequest,
  right: NormalizedAppOperationRequest,
): readonly AppOperationResource[] {
  const conflicts: AppOperationResource[] = [];
  for (const leftAccess of left.resources) {
    const rightAccess = right.resources.find(
      ({ resource }) => resource === leftAccess.resource,
    );
    if (
      rightAccess &&
      (leftAccess.mode === "write" || rightAccess.mode === "write")
    ) {
      conflicts.push(leftAccess.resource);
    }
  }
  return conflicts;
}

function requestsConflict(
  left: NormalizedAppOperationRequest,
  right: NormalizedAppOperationRequest,
): boolean {
  return conflictingResources(left, right).length > 0;
}

function canBypassBlockedOperation(
  blocked: PendingOperation,
  pending: PendingOperation,
  blockers: readonly PendingOperation[],
): boolean {
  const directBlockers = blockers.filter((blocker) =>
    requestsConflict(blocker.request, blocked.request),
  );
  const blockerResources = new Set(
    directBlockers.flatMap((blocker) =>
      blocker.request.resources.map(({ resource }) => resource),
    ),
  );
  // The session may relax fairness only inside domains it currently owns.
  // Otherwise a repository writer blocked by the session could reorder two
  // operations that conflict only on an unrelated resource such as chat data.
  const bypassedConflictResources = conflictingResources(
    blocked.request,
    pending.request,
  );
  return (
    directBlockers.length > 0 &&
    bypassedConflictResources.every((resource) =>
      blockerResources.has(resource),
    ) &&
    directBlockers.every(
      (blocker) =>
        blocker.request.allowCompatibleQueueBypass === true &&
        !requestsConflict(blocker.request, pending.request),
    )
  );
}

/**
 * Coordinates main-process work by the app resources it actually touches.
 *
 * Operations acquire all declared resources atomically. A blocked writer is a
 * barrier only for later work that conflicts with it, so unrelated domains can
 * continue without starving the writer. App deletion closes admission before
 * draining both active and queued operations.
 */
export class AppOperationCoordinator {
  private readonly states = new Map<number, AppOperationState>();

  run<Result>(
    request: AppOperationRequest,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    const state = this.getOrCreateState(request.appId);
    if (state.deletion) {
      return Promise.reject(
        new DyadError(
          "App is temporarily unavailable",
          DyadErrorKind.Precondition,
        ),
      );
    }

    // Synchronous with the enqueue below: a recording reserving this app in
    // between is what a caller-side check cannot rule out.
    if (request.refuseWhenRecording !== undefined) {
      try {
        assertNoActiveRecording(request.appId, request.refuseWhenRecording);
      } catch (error) {
        // Nothing was enqueued, so the state this refusal just created would
        // otherwise be retained empty for the lifetime of the process.
        this.removeStateIfIdle(request.appId, state);
        return Promise.reject(error);
      }
    }

    const normalizedRequest: NormalizedAppOperationRequest = {
      ...request,
      resources: normalizeResources(request.resources),
    };

    return new Promise<Result>((resolve, reject) => {
      state.queue.push({
        request: normalizedRequest,
        execute: operation,
        resolve: (result) => resolve(result as Result),
        reject,
      });
      this.pump(request.appId, state);
    });
  }

  isBusy(appId: number, resources: AppOperationRequest["resources"]): boolean {
    const state = this.states.get(appId);
    if (!state) return false;
    const request: NormalizedAppOperationRequest = {
      appId,
      operation: "inspect",
      resources: normalizeResources(resources),
    };
    return [...state.active, ...state.queue].some((pending) =>
      requestsConflict(pending.request, request),
    );
  }

  beginAppDeletion(appId: number): AppOperationDeletion {
    const state = this.getOrCreateState(appId);
    if (state.deletion) {
      throw new AppDeletionInProgressError(appId);
    }

    const token = Symbol(`app-deletion:${appId}`);
    state.deletion = { token, drainWaiters: new Set() };
    let drained = false;
    let released = false;
    let exclusiveRunning = false;

    const assertOwner = () => {
      if (released || state.deletion?.token !== token) {
        throw new Error(`App ${appId} deletion ownership is no longer active`);
      }
    };

    return {
      drain: async () => {
        assertOwner();
        if (state.active.size > 0 || state.queue.length > 0) {
          await new Promise<void>((resolve) => {
            state.deletion!.drainWaiters.add(resolve);
          });
        }
        assertOwner();
        drained = true;
      },
      runExclusive: async <Result>(operation: () => Promise<Result>) => {
        assertOwner();
        if (!drained || state.active.size > 0 || state.queue.length > 0) {
          throw new Error(
            `App ${appId} deletion must drain admitted operations before running exclusively`,
          );
        }
        if (exclusiveRunning) {
          throw new Error(
            `App ${appId} deletion already has an exclusive operation in progress`,
          );
        }
        exclusiveRunning = true;
        try {
          return await operation();
        } finally {
          exclusiveRunning = false;
        }
      },
      release: () => {
        if (released) return;
        assertOwner();
        if (exclusiveRunning) {
          throw new Error(
            `App ${appId} deletion cannot be released during an exclusive operation`,
          );
        }
        released = true;
        state.deletion = undefined;
        this.removeStateIfIdle(appId, state);
      },
    };
  }

  private getOrCreateState(appId: number): AppOperationState {
    let state = this.states.get(appId);
    if (!state) {
      state = { active: new Set(), queue: [] };
      this.states.set(appId, state);
    }
    return state;
  }

  private pump(appId: number, state: AppOperationState): void {
    const blocked: PendingOperation[] = [];
    const ready: PendingOperation[] = [];

    for (const pending of state.queue) {
      const activeAndReady = [...state.active, ...ready];
      const conflictsWithActive = activeAndReady.some((active) =>
        requestsConflict(active.request, pending.request),
      );
      const wouldBypassBlocked = blocked.some(
        (earlier) =>
          requestsConflict(earlier.request, pending.request) &&
          !canBypassBlockedOperation(earlier, pending, activeAndReady),
      );
      if (conflictsWithActive || wouldBypassBlocked) {
        blocked.push(pending);
      } else {
        ready.push(pending);
      }
    }

    if (ready.length === 0) {
      this.resolveDeletionDrainIfIdle(state);
      this.removeStateIfIdle(appId, state);
      return;
    }

    const readySet = new Set(ready);
    state.queue = state.queue.filter((pending) => !readySet.has(pending));
    for (const pending of ready) {
      state.active.add(pending);
      void Promise.resolve()
        .then(pending.execute)
        .then(pending.resolve, pending.reject)
        .finally(() => {
          state.active.delete(pending);
          this.pump(appId, state);
        });
    }
  }

  private resolveDeletionDrainIfIdle(state: AppOperationState): void {
    if (!state.deletion || state.active.size > 0 || state.queue.length > 0) {
      return;
    }
    const waiters = [...state.deletion.drainWaiters];
    state.deletion.drainWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  private removeStateIfIdle(appId: number, state: AppOperationState): void {
    if (
      !state.deletion &&
      state.active.size === 0 &&
      state.queue.length === 0 &&
      this.states.get(appId) === state
    ) {
      this.states.delete(appId);
    }
  }
}

export const appOperationCoordinator = new AppOperationCoordinator();

export function readAppResource(
  resource: AppOperationResource,
): AppOperationAccess {
  return { resource, mode: "read" };
}
