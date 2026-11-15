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

  function pump() {
    while (running.size < concurrency && pending.length > 0) {
      const entry = pending.shift()!;
      running.add(entry);
      void execute(entry);
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
   * Wait for every job of one app, moving its waiting jobs to the front so a
   * caller that is blocked on this app (deletion) does not also wait out other
   * apps' backlogs.
   */
  async function settleApp(appId: number): Promise<void> {
    const own = pending.filter((entry) => entry.job.appId === appId);
    if (own.length > 0) {
      const others = pending.filter((entry) => entry.job.appId !== appId);
      pending.splice(0, pending.length, ...own, ...others);
    }
    await Promise.all(
      [...running, ...own]
        .filter((entry) => entry.job.appId === appId)
        .map((entry) => entry.done),
    );
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

export function settleE2eTestCleanupsForApp(appId: number): Promise<void> {
  return e2eTestCleanupQueue.settleApp(appId);
}

export function settleE2eTestCleanups(): Promise<void> {
  return e2eTestCleanupQueue.settleAll();
}
