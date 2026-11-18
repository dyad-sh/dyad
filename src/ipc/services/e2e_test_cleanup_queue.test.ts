import { describe, expect, it } from "vitest";
import { createE2eTestCleanupQueue } from "./e2e_test_cleanup_queue";

/** A job that runs until released, recording when it started. */
function blockingJob(appId: number, started: string[], name: string) {
  let release!: () => void;
  let fail!: (error: Error) => void;
  const job = {
    appId,
    label: name,
    run: () =>
      new Promise<void>((resolve, reject) => {
        started.push(name);
        release = resolve;
        fail = reject;
      }),
  };
  return {
    job,
    release: () => release(),
    fail: (error: Error) => fail(error),
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("e2e test cleanup queue", () => {
  it("runs at most `concurrency` deletions at once, in arrival order", async () => {
    const queue = createE2eTestCleanupQueue({ concurrency: 2, maxPending: 8 });
    const started: string[] = [];
    const jobs = ["a", "b", "c", "d"].map((name) =>
      blockingJob(1, started, name),
    );
    const outcomes = jobs.map(({ job }) => queue.enqueue(job));

    await flush();
    expect(started).toEqual(["a", "b"]);
    expect(queue.size()).toEqual({ running: 2, pending: 2 });

    jobs[1].release();
    await flush();
    expect(started).toEqual(["a", "b", "c"]);

    jobs[0].release();
    jobs[2].release();
    await flush();
    jobs[3].release();
    expect(await Promise.all(outcomes)).toEqual([
      "completed",
      "completed",
      "completed",
      "completed",
    ]);
    expect(queue.size()).toEqual({ running: 0, pending: 0 });
  });

  it("leaves deletions past the backlog bound to the startup sweep", async () => {
    const queue = createE2eTestCleanupQueue({ concurrency: 1, maxPending: 1 });
    const started: string[] = [];
    const running = blockingJob(1, started, "running");
    const waiting = blockingJob(1, started, "waiting");
    const overflow = blockingJob(1, started, "overflow");

    const first = queue.enqueue(running.job);
    const second = queue.enqueue(waiting.job);
    expect(await queue.enqueue(overflow.job)).toBe("deferred");

    running.release();
    await flush();
    waiting.release();
    expect([await first, await second]).toEqual(["completed", "completed"]);
    expect(started).toEqual(["running", "waiting"]);
  });

  it("settles a failed deletion without rejecting or stalling later ones", async () => {
    const queue = createE2eTestCleanupQueue({ concurrency: 1, maxPending: 8 });
    const started: string[] = [];
    const failing = blockingJob(1, started, "failing");
    const next = blockingJob(1, started, "next");

    const failed = queue.enqueue(failing.job);
    const later = queue.enqueue(next.job);
    await flush();
    failing.fail(new Error("EBUSY"));
    expect(await failed).toBe("failed");

    await flush();
    expect(started).toEqual(["failing", "next"]);
    next.release();
    expect(await later).toBe("completed");
  });

  it("starts a settled app's deletions without waiting for other apps' slots", async () => {
    // Another app's dependency-tree deletion can hold every slot for minutes;
    // the app being deleted or moved must not wait it out.
    const queue = createE2eTestCleanupQueue({ concurrency: 1, maxPending: 8 });
    const started: string[] = [];
    const busy = blockingJob(1, started, "app1-running");
    const otherWaiting = blockingJob(1, started, "app1-waiting");
    const target = blockingJob(2, started, "app2-waiting");
    queue.enqueue(busy.job);
    queue.enqueue(otherWaiting.job);
    queue.enqueue(target.job);

    let settled = false;
    const settling = queue.settleApp(2).then(() => {
      settled = true;
    });
    await flush();
    expect(started).toEqual(["app1-running", "app2-waiting"]);
    expect(queue.size()).toEqual({ running: 2, pending: 1 });
    expect(settled).toBe(false);

    target.release();
    await settling;
    expect(settled).toBe(true);
    // Other apps keep the normal limit: app 1's waiting job still needs a slot.
    await flush();
    expect(started).toEqual(["app1-running", "app2-waiting"]);
    busy.release();
    await flush();
    expect(started).toEqual(["app1-running", "app2-waiting", "app1-waiting"]);
    otherWaiting.release();
    await queue.settleAll();
  });

  it("also starts deletions the settled app enqueues while it waits", async () => {
    const queue = createE2eTestCleanupQueue({ concurrency: 1, maxPending: 8 });
    const started: string[] = [];
    const busy = blockingJob(1, started, "app1-running");
    const first = blockingJob(2, started, "app2-first");
    const late = blockingJob(2, started, "app2-late");
    queue.enqueue(busy.job);
    queue.enqueue(first.job);

    let settled = false;
    const settling = queue.settleApp(2).then(() => {
      settled = true;
    });
    await flush();
    queue.enqueue(late.job);
    first.release();
    await flush();
    expect(started).toEqual(["app1-running", "app2-first", "app2-late"]);
    expect(settled).toBe(false);

    late.release();
    await settling;
    busy.release();
    await queue.settleAll();
  });

  it("does not wait on other apps' deletions when an app has none", async () => {
    const queue = createE2eTestCleanupQueue({ concurrency: 1, maxPending: 8 });
    const started: string[] = [];
    const other = blockingJob(1, started, "other");
    queue.enqueue(other.job);

    await queue.settleApp(2);

    other.release();
    await queue.settleAll();
  });

  it("drains deletions enqueued while it waits", async () => {
    const queue = createE2eTestCleanupQueue({ concurrency: 1, maxPending: 8 });
    const started: string[] = [];
    const first = blockingJob(1, started, "first");
    const second = blockingJob(1, started, "second");
    queue.enqueue(first.job);

    let drained = false;
    const draining = queue.settleAll().then(() => {
      drained = true;
    });
    queue.enqueue(second.job);
    first.release();
    await flush();
    expect(drained).toBe(false);
    second.release();
    await draining;
    expect(queue.size()).toEqual({ running: 0, pending: 0 });
  });
});
