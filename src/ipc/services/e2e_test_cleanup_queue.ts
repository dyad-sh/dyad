import log from "electron-log";

const logger = log.scope("e2e_test_cleanup_queue");

/**
 * Deletions running at once. Each is typically a cloned dependency tree, tens
 * of thousands of unlinks on the same disk the next run is installing onto, so
 * more parallelism mostly competes with live work. Two rather than one so a
 * single slow deletion (a scanner holding handles, `fs.rm` retrying) does not
 * hold every later one.
 */
export const E2E_TEST_CLEANUP_CONCURRENCY = 2;

/**
 * Deletions waiting for a slot. Past this, a new deletion is left to the
 * startup sweep instead of growing the backlog: every job here removes a run
 * directory that sweep already recognizes (owner-marked sandboxes, superseded
 * or orphaned artifacts), so deferring costs disk space until the next launch,
 * never correctness.
 */
export const E2E_TEST_CLEANUP_MAX_PENDING = 32;

export type E2eTestCleanupOutcome = "completed" | "failed" | "deferred";

export interface E2eTestCleanupJob {
  /** App whose directories this removes; app deletion waits on its own jobs. */
  appId: number;
  /** Fixed description for logs, such as "test workspace". Never a path. */
  label: string;
  run: () => Promise<void>;
}

interface Entry {
  job: E2eTestCleanupJob;
  done: Promise<E2eTestCleanupOutcome>;
  settle: (outcome: E2eTestCleanupOutcome) => void;
}

/**
 * Bounded background queue for test-run directory deletion.
 *
 * Results are published before their sandbox and superseded artifacts are
 * deleted, so nothing awaiting a run waits on the filesystem. The returned
 * promises never reject: a failure is logged here and the startup sweep
 * retries it, so a caller that drops the promise cannot leak a rejection.
 */
export function createE2eTestCleanupQueue({
  concurrency = E2E_TEST_CLEANUP_CONCURRENCY,
  maxPending = E2E_TEST_CLEANUP_MAX_PENDING,
}: { concurrency?: number; maxPending?: number } = {}) {
  const pending: Entry[] = [];
  const running = new Set<Entry>();

  function start(entry: Entry) {
    running.add(entry);
    void execute(entry);
  }

  function pump() {
    while (running.size < concurrency && pending.length > 0) {
      start(pending.shift()!);
    }
  }

  async function execute(entry: Entry) {
    let outcome: E2eTestCleanupOutcome = "completed";
    try {
      await entry.job.run();
    } catch (error) {
      outcome = "failed";
      logger.warn(
        `Failed to remove ${entry.job.label} for app ${entry.job.appId}; the startup sweep will retry: ${error}`,
      );
    } finally {
      running.delete(entry);
      entry.settle(outcome);
      pump();
    }
  }

  function enqueue(job: E2eTestCleanupJob): Promise<E2eTestCleanupOutcome> {
    if (pending.length >= maxPending) {
      logger.warn(
        `Cleanup backlog is full (${pending.length} waiting); leaving ${job.label} for app ${job.appId} to the startup sweep.`,
      );
      return Promise.resolve("deferred");
    }
    let settle!: Entry["settle"];
    const done = new Promise<E2eTestCleanupOutcome>((resolve) => {
      settle = resolve;
    });
    pending.push({ job, done, settle });
    pump();
    return done;
  }

  /**
   * Wait for every job of one app, starting its waiting jobs immediately.
   *
   * The caller is blocked on this app (deletion, or a move of its repository),
   * so its jobs skip the concurrency limit: other apps' dependency-tree
   * deletions can hold every slot for minutes, and reordering alone would still
   * leave this app's jobs waiting behind them. The bypass is bounded by one
   * app's own backlog, typically a sandbox and a prune per finished run.
   */
  async function settleApp(appId: number): Promise<void> {
    for (;;) {
      for (const entry of pending.filter((e) => e.job.appId === appId)) {
        pending.splice(pending.indexOf(entry), 1);
        start(entry);
      }
      const own = [...running].filter((entry) => entry.job.appId === appId);
      if (own.length === 0) return;
      await Promise.all(own.map((entry) => entry.done));
    }
  }

  /** Wait until the queue is empty, including jobs enqueued meanwhile. */
  async function settleAll(): Promise<void> {
    while (running.size > 0 || pending.length > 0) {
      await Promise.all([...running, ...pending].map((entry) => entry.done));
    }
  }

  return {
    enqueue,
    settleApp,
    settleAll,
    size: () => ({ running: running.size, pending: pending.length }),
  };
}

const e2eTestCleanupQueue = createE2eTestCleanupQueue();

export function scheduleE2eTestCleanup(
  job: E2eTestCleanupJob,
): Promise<E2eTestCleanupOutcome> {
  return e2eTestCleanupQueue.enqueue(job);
}

/**
 * Wait for one app's queued deletions, starting them immediately.
 *
 * Required before the app's repository is deleted or moved (rename, relocation,
 * template path swap). Removing a sandbox ends by withdrawing its worktree
 * registration with Git running inside that repository, using the path
 * captured when the run started. A move first would leave the registration in
 * the moved copy and run Git against a directory being copied or deleted.
 * Jobs take no coordinator claims, so a caller holding `app-path` cannot
 * deadlock here.
 */
export function settleE2eTestCleanupsForApp(appId: number): Promise<void> {
  return e2eTestCleanupQueue.settleApp(appId);
}

export function settleE2eTestCleanups(): Promise<void> {
  return e2eTestCleanupQueue.settleAll();
}
