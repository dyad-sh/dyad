export const SUPABASE_BUNDLE_ONLY_DEPLOY_CONCURRENCY = 8;
export const SUPABASE_ACTIVATING_DEPLOY_CONCURRENCY = 1;

type QueueTask<T> = {
  operation: () => Promise<T>;
  bundleOnly: boolean;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

class SupabaseDeployQueue {
  private activeBundleOnlyCount = 0;
  private activeActivatingCount = 0;
  private readonly pendingTasks: QueueTask<unknown>[] = [];

  enqueue<T>(bundleOnly: boolean, operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingTasks.push({
        operation,
        bundleOnly,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
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
): Promise<T> {
  let queue = deployQueuesByProject.get(supabaseProjectId);
  if (!queue) {
    queue = new SupabaseDeployQueue();
    deployQueuesByProject.set(supabaseProjectId, queue);
  }
  return queue.enqueue(bundleOnly, operation);
}

export function resetSupabaseDeployQueuesForTests() {
  deployQueuesByProject.clear();
}
