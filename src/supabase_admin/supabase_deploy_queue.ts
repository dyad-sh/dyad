export const SUPABASE_DEPLOY_CONCURRENCY = 16;

type QueueTask<T> = {
  operation: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
};

class SupabaseDeployQueue {
  private activeCount = 0;
  private readonly pendingTasks: QueueTask<unknown>[] = [];

  constructor(private readonly concurrency: number) {}

  enqueue<T>(operation: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pendingTasks.push({
        operation,
        resolve: resolve as (value: unknown) => void,
        reject,
      });
      this.drain();
    });
  }

  private drain() {
    while (
      this.activeCount < this.concurrency &&
      this.pendingTasks.length > 0
    ) {
      const task = this.pendingTasks.shift()!;
      this.activeCount++;
      void this.runTask(task);
    }
  }

  private async runTask(task: QueueTask<unknown>) {
    try {
      task.resolve(await task.operation());
    } catch (error) {
      task.reject(error);
    } finally {
      this.activeCount--;
      this.drain();
    }
  }
}

const deployQueuesByProject = new Map<string, SupabaseDeployQueue>();

export function enqueueSupabaseDeploy<T>(
  supabaseProjectId: string,
  operation: () => Promise<T>,
): Promise<T> {
  let queue = deployQueuesByProject.get(supabaseProjectId);
  if (!queue) {
    queue = new SupabaseDeployQueue(SUPABASE_DEPLOY_CONCURRENCY);
    deployQueuesByProject.set(supabaseProjectId, queue);
  }
  return queue.enqueue(operation);
}

export function resetSupabaseDeployQueuesForTests() {
  deployQueuesByProject.clear();
}
