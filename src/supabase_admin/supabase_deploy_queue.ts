export const SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY = 4;
export const SUPABASE_ACTIVATING_DEPLOY_CONCURRENCY = 1;

type QueueTask<T> = {
  operation: () => Promise<T>;
  bundleOnly: boolean;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
  detachAbort: () => void;
};

class SupabaseDeployQueue {
  private activeBundleOnlyCount = 0;
  private activeActivatingCount = 0;
  private readonly pendingTasks: QueueTask<unknown>[] = [];

  enqueue<T>(
    bundleOnly: boolean,
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      signal?.throwIfAborted();
      const onAbort = () => {
        const index = this.pendingTasks.indexOf(task);
        if (index < 0) return;
        this.pendingTasks.splice(index, 1);
        task.detachAbort();
        reject(signal?.reason);
        this.drain();
      };
      const task: QueueTask<unknown> = {
        operation,
        bundleOnly,
        resolve: resolve as (value: unknown) => void,
        reject,
        detachAbort: () => signal?.removeEventListener("abort", onAbort),
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.pendingTasks.push(task);
      this.drain();
    });
  }

  private drain() {
    while (this.pendingTasks.length > 0) {
      const task = this.pendingTasks[0];
      if (!this.canStart(task)) {
        return;
      }
      this.pendingTasks.shift();
      task.detachAbort();
      this.incrementActiveCount(task);
      void this.runTask(task);
    }
  }

  private canStart(task: QueueTask<unknown>) {
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

  private incrementActiveCount(task: QueueTask<unknown>) {
    if (task.bundleOnly) {
      this.activeBundleOnlyCount++;
    } else {
      this.activeActivatingCount++;
    }
  }

  private decrementActiveCount(task: QueueTask<unknown>) {
    if (task.bundleOnly) {
      this.activeBundleOnlyCount--;
    } else {
      this.activeActivatingCount--;
    }
  }

  private async runTask(task: QueueTask<unknown>) {
    try {
      task.resolve(await task.operation());
    } catch (error) {
      task.reject(error);
    } finally {
      this.decrementActiveCount(task);
      this.drain();
    }
  }
}

const deployQueuesByProject = new Map<string, SupabaseDeployQueue>();

export function enqueueSupabaseDeploy<T>(
  supabaseProjectId: string,
  bundleOnly: boolean,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let queue = deployQueuesByProject.get(supabaseProjectId);
  if (!queue) {
    queue = new SupabaseDeployQueue();
    deployQueuesByProject.set(supabaseProjectId, queue);
  }
  return queue.enqueue(bundleOnly, operation, signal);
}

export function resetSupabaseDeployQueuesForTests() {
  deployQueuesByProject.clear();
}
