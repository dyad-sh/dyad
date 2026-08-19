import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn() }) },
}));

const {
  backoffMs,
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  jobCounts,
  listJobs,
  MAX_ATTEMPTS,
  recoverAbandonedJobs,
  retryFailedJob,
  stateDirectory,
} = await import("@/ipc/utils/memory_jobs");

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "memory-jobs-"));
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

const sample = {
  conversationId: "conv-1",
  conversationPath: "Memory/Conversations/a.md",
  content: "## User\n\nHello\n",
};

describe("enqueueJob", () => {
  it("writes a job with the fields a worker needs", async () => {
    const job = await enqueueJob(vault, sample);

    expect(job).not.toBeNull();
    expect(job!.type).toBe("memory-extraction");
    expect(job!.conversation_id).toBe("conv-1");
    expect(job!.conversation_path).toBe("Memory/Conversations/a.md");
    expect(job!.status).toBe("pending");
    expect(job!.attempts).toBe(0);
    expect(job!.content_hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("creates the four queue directories", async () => {
    await enqueueJob(vault, sample);
    for (const state of [
      "Pending",
      "Processing",
      "Completed",
      "Failed",
    ] as const) {
      expect(fs.existsSync(stateDirectory(vault, state))).toBe(true);
    }
  });

  it("ignores a duplicate submission of identical content", async () => {
    // Saving the same conversation twice must not queue the work twice.
    expect(await enqueueJob(vault, sample)).not.toBeNull();
    expect(await enqueueJob(vault, sample)).toBeNull();
    expect(listJobs(vault, "Pending")).toHaveLength(1);
  });

  it("queues again once the conversation has changed", async () => {
    await enqueueJob(vault, sample);
    await enqueueJob(vault, { ...sample, content: `${sample.content}more\n` });
    expect(listJobs(vault, "Pending")).toHaveLength(2);
  });

  it("does not re-queue a job that is already running", async () => {
    await enqueueJob(vault, sample);
    await claimNextJob(vault);
    expect(await enqueueJob(vault, sample)).toBeNull();
  });

  it("survives concurrent submission of the same job", async () => {
    const results = await Promise.all([
      enqueueJob(vault, sample),
      enqueueJob(vault, sample),
      enqueueJob(vault, sample),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(listJobs(vault, "Pending")).toHaveLength(1);
  });
});

describe("claimNextJob", () => {
  it("moves the job to Processing and counts the attempt", async () => {
    await enqueueJob(vault, sample);
    const claimed = await claimNextJob(vault);

    expect(claimed!.status).toBe("processing");
    expect(claimed!.attempts).toBe(1);
    expect(listJobs(vault, "Pending")).toHaveLength(0);
    expect(listJobs(vault, "Processing")).toHaveLength(1);
  });

  it("returns null when the queue is empty", async () => {
    expect(await claimNextJob(vault)).toBeNull();
  });

  it("leaves a job alone while it is backing off", async () => {
    await enqueueJob(vault, sample);
    const claimed = await claimNextJob(vault);
    await failJob(vault, claimed!, "service down", 1_000);

    expect(await claimNextJob(vault, 1_500)).toBeNull();
    expect(await claimNextJob(vault, 99_000)).not.toBeNull();
  });

  it("never hands the same job to two workers", async () => {
    await enqueueJob(vault, sample);
    const [first, second] = await Promise.all([
      claimNextJob(vault),
      claimNextJob(vault),
    ]);
    expect([first, second].filter(Boolean)).toHaveLength(1);
  });
});

describe("recoverAbandonedJobs", () => {
  it("returns work interrupted by a crash to the queue", async () => {
    // Nothing survives in Processing across a restart, so anything there
    // belongs to a run that died.
    await enqueueJob(vault, sample);
    await claimNextJob(vault);
    expect(listJobs(vault, "Processing")).toHaveLength(1);

    expect(await recoverAbandonedJobs(vault)).toBe(1);

    expect(listJobs(vault, "Processing")).toHaveLength(0);
    expect(listJobs(vault, "Pending")).toHaveLength(1);
  });

  it("makes the recovered job immediately claimable", async () => {
    await enqueueJob(vault, sample);
    await claimNextJob(vault);
    await recoverAbandonedJobs(vault);
    expect(await claimNextJob(vault)).not.toBeNull();
  });

  it("does nothing when there is nothing to recover", async () => {
    expect(await recoverAbandonedJobs(vault)).toBe(0);
  });
});

describe("failJob", () => {
  it("returns the job to Pending with a backoff", async () => {
    await enqueueJob(vault, sample);
    const claimed = await claimNextJob(vault);

    expect(await failJob(vault, claimed!, "embeddings offline", 0)).toBe(
      "Pending",
    );
    const [pending] = listJobs(vault, "Pending");
    expect(pending!.next_attempt_at).toBe(backoffMs(1));
    expect(pending!.last_error).toBe("embeddings offline");
  });

  it("gives up after the attempt limit and keeps the job readable", async () => {
    await enqueueJob(vault, sample);
    let job = await claimNextJob(vault);
    for (let i = 0; i < MAX_ATTEMPTS; i += 1) {
      await failJob(vault, job!, "still down", 0);
      job = await claimNextJob(vault, Number.MAX_SAFE_INTEGER);
      if (!job) break;
    }
    expect(listJobs(vault, "Failed").length).toBeGreaterThan(0);
    expect(listJobs(vault, "Failed")[0]!.last_error).toBe("still down");
  });
});

describe("completeJob", () => {
  it("moves the job to Completed and out of every other state", async () => {
    await enqueueJob(vault, sample);
    const claimed = await claimNextJob(vault);
    await completeJob(vault, claimed!);

    expect(jobCounts(vault)).toEqual({
      Pending: 0,
      Processing: 0,
      Completed: 1,
      Failed: 0,
    });
  });
});

describe("retryFailedJob", () => {
  it("puts a failed job back with its attempts cleared", async () => {
    await enqueueJob(vault, sample);
    const claimed = await claimNextJob(vault);
    await failJob(vault, { ...claimed!, attempts: MAX_ATTEMPTS }, "gave up", 0);
    expect(listJobs(vault, "Failed")).toHaveLength(1);

    const hash = listJobs(vault, "Failed")[0]!.content_hash;
    expect(await retryFailedJob(vault, hash)).toBe(true);

    const [pending] = listJobs(vault, "Pending");
    expect(pending!.attempts).toBe(0);
    expect(pending!.next_attempt_at).toBeUndefined();
  });

  it("reports when there is nothing to retry", async () => {
    expect(await retryFailedJob(vault, "nope")).toBe(false);
  });
});

describe("backoffMs", () => {
  it("doubles each attempt", () => {
    expect(backoffMs(1)).toBe(1_000);
    expect(backoffMs(2)).toBe(2_000);
    expect(backoffMs(3)).toBe(4_000);
  });

  it("is capped so a job never waits out the session", () => {
    expect(backoffMs(50)).toBe(60_000);
  });
});

describe("durability", () => {
  it("keeps queued work across a restart", async () => {
    // The queue is the filesystem, so a fresh process sees the same jobs.
    await enqueueJob(vault, sample);
    const seenLater = listJobs(vault, "Pending");
    expect(seenLater).toHaveLength(1);
    expect(seenLater[0]!.conversation_id).toBe("conv-1");
  });

  it("ignores an unreadable job file rather than failing the queue", async () => {
    await enqueueJob(vault, sample);
    fs.writeFileSync(
      path.join(stateDirectory(vault, "Pending"), "corrupt.json"),
      "{ not json",
    );
    expect(listJobs(vault, "Pending")).toHaveLength(1);
  });

  it("ignores macOS AppleDouble sidecars on external vaults", async () => {
    await enqueueJob(vault, sample);
    fs.writeFileSync(
      path.join(stateDirectory(vault, "Pending"), "._metadata.json"),
      JSON.stringify({ appleDouble: true }),
    );
    expect(listJobs(vault, "Pending")).toHaveLength(1);
    expect(jobCounts(vault).Pending).toBe(1);
  });

  it("leaves a job in exactly one state at a time", async () => {
    await enqueueJob(vault, sample);
    const claimed = await claimNextJob(vault);
    await completeJob(vault, claimed!);
    const total = Object.values(jobCounts(vault)).reduce((a, b) => a + b, 0);
    expect(total).toBe(1);
  });
});
