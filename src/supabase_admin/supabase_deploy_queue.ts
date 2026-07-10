import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  MAX_SUPABASE_DEPLOY_PENDING_TASKS_PER_PROJECT,
  SUPABASE_DEPLOY_ACTIVE_PAYLOAD_BYTE_BUDGET,
} from "./supabase_deploy_limits";

export const SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY = 8;
export const SUPABASE_ACTIVATING_DEPLOY_CONCURRENCY = 1;
export const SUPABASE_DEPLOY_GLOBAL_CONCURRENCY = 8;

export interface SupabaseDeployQueueOptions {
  /** Raw source bytes retained while the request is active. */
  estimatedBytes?: number;
  /** Equivalent pending/active jobs share one promise instead of duplicating work. */
  coalesceKey?: string;
}

type QueueTask<T> = {
  operation: () => Promise<T>;
  bundleOnly: boolean;
  estimatedBytes: number;
  coalesceKey?: string;
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

let activePayloadBytes = 0;
let activeTaskCount = 0;
let isDrainingAllQueues = false;

class SupabaseDeployQueue {
  private activeBundleOnlyCount = 0;
  private activeActivatingCount = 0;
  private readonly pendingTasks: QueueTask<unknown>[] = [];
  private readonly coalescedTasks = new Map<string, Promise<unknown>>();

  constructor(private readonly onIdle: () => void) {}

  enqueue<T>(
    bundleOnly: boolean,
    operation: () => Promise<T>,
    options: SupabaseDeployQueueOptions,
  ): Promise<T> {
    const coalesceKey = options.coalesceKey
      ? `${bundleOnly ? "bundle" : "activate"}:${options.coalesceKey}`
      : undefined;
    if (coalesceKey) {
      const existing = this.coalescedTasks.get(coalesceKey);
      if (existing) {
        return existing as Promise<T>;
      }
    }

    if (
      this.pendingTasks.length >= MAX_SUPABASE_DEPLOY_PENDING_TASKS_PER_PROJECT
    ) {
      return Promise.reject(
        new DyadError(
          `Too many Supabase deployments are queued for this project (maximum ${MAX_SUPABASE_DEPLOY_PENDING_TASKS_PER_PROJECT})`,
          DyadErrorKind.RateLimited,
        ),
      );
    }

    const estimatedBytes = normalizeEstimatedBytes(options.estimatedBytes);
    let resolveTask!: (value: T) => void;
    let rejectTask!: (error: unknown) => void;
    const promise = new Promise<T>((resolve, reject) => {
      resolveTask = resolve;
      rejectTask = reject;
    });
    const task: QueueTask<T> = {
      operation,
      bundleOnly,
      estimatedBytes,
      coalesceKey,
      promise,
      resolve: resolveTask,
      reject: rejectTask,
    };

    this.pendingTasks.push(task as QueueTask<unknown>);
    if (coalesceKey) {
      this.coalescedTasks.set(coalesceKey, promise);
    }
    drainAllDeployQueues();
    return promise;
  }

  drain(maxTasks = Number.POSITIVE_INFINITY): number {
    let startedTasks = 0;
    while (this.pendingTasks.length > 0 && startedTasks < maxTasks) {
      const task = this.pendingTasks[0];
      if (!this.canStart(task)) {
        break;
      }
      this.pendingTasks.shift();
      this.incrementActiveCount(task);
      void this.runTask(task);
      startedTasks++;
    }
    this.notifyIfIdle();
    return startedTasks;
  }

  getStats(): { pending: number; active: number } {
    return {
      pending: this.pendingTasks.length,
      active: this.activeBundleOnlyCount + this.activeActivatingCount,
    };
  }

  private canStart(task: QueueTask<unknown>): boolean {
    if (
      activeTaskCount >= SUPABASE_DEPLOY_GLOBAL_CONCURRENCY ||
      !canReservePayloadBytes(task.estimatedBytes)
    ) {
      return false;
    }

    if (task.bundleOnly) {
      return (
        this.activeActivatingCount === 0 &&
        this.activeBundleOnlyCount < SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY
      );
    }

    return (
      this.activeActivatingCount < SUPABASE_ACTIVATING_DEPLOY_CONCURRENCY &&
      this.activeBundleOnlyCount === 0
    );
  }

  private incrementActiveCount(task: QueueTask<unknown>): void {
    if (task.bundleOnly) {
      this.activeBundleOnlyCount++;
    } else {
      this.activeActivatingCount++;
    }
    activeTaskCount++;
    activePayloadBytes += task.estimatedBytes;
  }

  private decrementActiveCount(task: QueueTask<unknown>): void {
    if (task.bundleOnly) {
      this.activeBundleOnlyCount--;
    } else {
      this.activeActivatingCount--;
    }
    activeTaskCount = Math.max(0, activeTaskCount - 1);
    activePayloadBytes = Math.max(0, activePayloadBytes - task.estimatedBytes);
  }

  private async runTask(task: QueueTask<unknown>): Promise<void> {
    try {
      task.resolve(await task.operation());
    } catch (error) {
      task.reject(error);
    } finally {
      this.decrementActiveCount(task);
      if (
        task.coalesceKey &&
        this.coalescedTasks.get(task.coalesceKey) === task.promise
      ) {
        this.coalescedTasks.delete(task.coalesceKey);
      }
      this.notifyIfIdle();
      drainAllDeployQueues();
    }
  }

  private notifyIfIdle(): void {
    if (
      this.pendingTasks.length === 0 &&
      this.activeBundleOnlyCount === 0 &&
      this.activeActivatingCount === 0
    ) {
      this.onIdle();
    }
  }
}

const deployQueuesByProject = new Map<string, SupabaseDeployQueue>();

export function enqueueSupabaseDeploy<T>(
  supabaseProjectId: string,
  bundleOnly: boolean,
  operation: () => Promise<T>,
  options: SupabaseDeployQueueOptions = {},
): Promise<T> {
  let queue = deployQueuesByProject.get(supabaseProjectId);
  if (!queue) {
    queue = new SupabaseDeployQueue(() => {
      if (deployQueuesByProject.get(supabaseProjectId) === queue) {
        deployQueuesByProject.delete(supabaseProjectId);
      }
    });
    deployQueuesByProject.set(supabaseProjectId, queue);
  }
  return queue.enqueue(bundleOnly, operation, options);
}

export function getSupabaseDeployQueueStatsForTests(): {
  projects: number;
  pending: number;
  active: number;
  activePayloadBytes: number;
} {
  let pending = 0;
  let active = 0;
  for (const queue of deployQueuesByProject.values()) {
    const stats = queue.getStats();
    pending += stats.pending;
    active += stats.active;
  }
  return {
    projects: deployQueuesByProject.size,
    pending,
    active,
    activePayloadBytes,
  };
}

export function resetSupabaseDeployQueuesForTests(): void {
  deployQueuesByProject.clear();
  activePayloadBytes = 0;
  activeTaskCount = 0;
  isDrainingAllQueues = false;
}

function canReservePayloadBytes(estimatedBytes: number): boolean {
  if (estimatedBytes === 0) {
    return true;
  }
  if (activePayloadBytes === 0) {
    // Avoid deadlock if a future caller raises the per-payload limit without
    // also updating the active budget. Such a payload still runs alone.
    return true;
  }
  return (
    activePayloadBytes + estimatedBytes <=
    SUPABASE_DEPLOY_ACTIVE_PAYLOAD_BYTE_BUDGET
  );
}

function normalizeEstimatedBytes(estimatedBytes?: number): number {
  if (
    estimatedBytes === undefined ||
    !Number.isFinite(estimatedBytes) ||
    estimatedBytes <= 0
  ) {
    return 0;
  }
  return Math.ceil(estimatedBytes);
}

function drainAllDeployQueues(): void {
  if (isDrainingAllQueues) {
    return;
  }
  isDrainingAllQueues = true;
  try {
    let madeProgress = true;
    while (
      madeProgress &&
      activeTaskCount < SUPABASE_DEPLOY_GLOBAL_CONCURRENCY
    ) {
      madeProgress = false;
      const startedProjectIds: string[] = [];
      for (const [projectId, queue] of Array.from(
        deployQueuesByProject.entries(),
      )) {
        if (queue.drain(1) > 0) {
          madeProgress = true;
          startedProjectIds.push(projectId);
        }
        if (activeTaskCount >= SUPABASE_DEPLOY_GLOBAL_CONCURRENCY) {
          break;
        }
      }

      // Move projects admitted in this pass to the back so a project with a
      // long backlog cannot monopolize the next available byte/task slot.
      for (const projectId of startedProjectIds) {
        const queue = deployQueuesByProject.get(projectId);
        if (queue) {
          deployQueuesByProject.delete(projectId);
          deployQueuesByProject.set(projectId, queue);
        }
      }
    }
  } finally {
    isDrainingAllQueues = false;
  }
}
