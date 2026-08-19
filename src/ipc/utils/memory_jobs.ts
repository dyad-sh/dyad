/**
 * The durable queue behind memory extraction.
 *
 * Extraction runs after the reply has been delivered, which means it must
 * survive things the reply never had to: the app closing mid-job, the machine
 * losing power, the embedding service being down for an hour. A queue held in
 * memory would lose all of that silently, so the queue is the filesystem —
 * a job is a small JSON file, and its state is the directory it sits in.
 *
 * Two properties do the real work.
 *
 * Moves between states are `rename`, which is atomic within a filesystem. A
 * job is therefore never half-moved: it is in exactly one state at any instant,
 * even if the process dies mid-call.
 *
 * A job's filename is its content hash. Enqueuing the same conversation twice
 * writes the same name, so duplicate submission is prevented by the filesystem
 * rather than by a check that could race.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { memoryPath } from "./memory_vault";
import { hashContent } from "./embedding_provider";

const logger = log.scope("memory_jobs");

export type JobState = "Pending" | "Processing" | "Completed" | "Failed";

export const JOB_STATES: JobState[] = [
  "Pending",
  "Processing",
  "Completed",
  "Failed",
];

export type MemoryJob = {
  id: string;
  type: "memory-extraction";
  conversation_id: string;
  conversation_path: string;
  created_at: string;
  attempts: number;
  status: Lowercase<JobState>;
  content_hash: string;
  /** Epoch ms before which this job should not be retried. */
  next_attempt_at?: number;
  /** Why the last attempt failed, for a human reading the Failed folder. */
  last_error?: string;
};

/** Given up on after this many attempts; the job stays inspectable. */
export const MAX_ATTEMPTS = 5;

export function jobsRoot(vaultPath: string): string {
  return memoryPath(vaultPath, "System", "Jobs");
}

export function stateDirectory(vaultPath: string, state: JobState): string {
  return path.join(jobsRoot(vaultPath), state);
}

export async function ensureJobDirectories(vaultPath: string): Promise<void> {
  for (const state of JOB_STATES) {
    await fs.promises.mkdir(stateDirectory(vaultPath, state), {
      recursive: true,
    });
  }
}

/**
 * Delay before a failed job is tried again: 1s, 2s, 4s, 8s… capped.
 *
 * Capped because the thing being waited on is usually a local service coming
 * back, and an hour-long backoff would outlast the session.
 */
export function backoffMs(attempts: number): number {
  return Math.min(60_000, 1_000 * 2 ** Math.max(0, attempts - 1));
}

function jobFileName(contentHash: string): string {
  return `${contentHash}.json`;
}

/**
 * Adds a job unless an identical one is already waiting or running.
 *
 * Returns the job, or null when it was a duplicate. Completed work is *not*
 * treated as a duplicate barrier — a conversation that changes gets a new
 * hash, and one that has not changed produces no job at all upstream.
 */
export async function enqueueJob(
  vaultPath: string,
  input: {
    conversationId: string;
    conversationPath: string;
    content: string;
  },
): Promise<MemoryJob | null> {
  await ensureJobDirectories(vaultPath);
  const contentHash = hashContent(`${input.conversationId}:${input.content}`);
  const fileName = jobFileName(contentHash);

  // Already queued or in flight — nothing to do.
  for (const state of ["Pending", "Processing"] as JobState[]) {
    if (fs.existsSync(path.join(stateDirectory(vaultPath, state), fileName))) {
      return null;
    }
  }

  const job: MemoryJob = {
    id: `job-${contentHash.slice(0, 16)}`,
    type: "memory-extraction",
    conversation_id: input.conversationId,
    conversation_path: input.conversationPath,
    created_at: new Date().toISOString(),
    attempts: 0,
    status: "pending",
    content_hash: contentHash,
  };

  const target = path.join(stateDirectory(vaultPath, "Pending"), fileName);
  try {
    // `wx` loses the race rather than overwriting a job written concurrently.
    await fs.promises.writeFile(target, JSON.stringify(job, null, 2), {
      flag: "wx",
    });
    return job;
  } catch {
    return null;
  }
}

function readJob(filePath: string): MemoryJob | null {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as MemoryJob;
  } catch {
    return null;
  }
}

/** Every job in a state, newest last. Used for inspection and recovery. */
export function listJobs(vaultPath: string, state: JobState): MemoryJob[] {
  const directory = stateDirectory(vaultPath, state);
  if (!fs.existsSync(directory)) return [];
  return (
    fs
      .readdirSync(directory)
      // macOS creates AppleDouble `._*` sidecars on some external volumes.
      // They are metadata, not queue jobs, and may partially parse as objects.
      .filter((name) => !name.startsWith("._") && name.endsWith(".json"))
      .map((name) => readJob(path.join(directory, name)))
      .filter((job): job is MemoryJob => job !== null)
      .sort((a, b) => a.created_at.localeCompare(b.created_at))
  );
}

/**
 * Returns abandoned jobs to Pending.
 *
 * Anything sitting in Processing at startup belongs to a run that died: no
 * worker survives a restart, so the state is unambiguous. Attempts is not
 * incremented here — the job never got a fair try.
 */
export async function recoverAbandonedJobs(vaultPath: string): Promise<number> {
  await ensureJobDirectories(vaultPath);
  let recovered = 0;
  for (const job of listJobs(vaultPath, "Processing")) {
    const moved = await moveJob(vaultPath, job, "Pending");
    if (moved) recovered += 1;
  }
  if (recovered > 0) {
    logger.log(`Recovered ${recovered} interrupted memory job(s)`);
  }
  return recovered;
}

/** Moves a job to another state, rewriting its status. Atomic. */
async function moveJob(
  vaultPath: string,
  job: MemoryJob,
  to: JobState,
  changes: Partial<MemoryJob> = {},
): Promise<boolean> {
  const fileName = jobFileName(job.content_hash);
  const updated: MemoryJob = {
    ...job,
    ...changes,
    status: to.toLowerCase() as Lowercase<JobState>,
  };

  const destination = path.join(stateDirectory(vaultPath, to), fileName);
  // Write the new contents beside the destination, then rename into place, so
  // a crash cannot leave a partially written job file.
  const staging = `${destination}.tmp`;
  try {
    await fs.promises.writeFile(staging, JSON.stringify(updated, null, 2));
    await fs.promises.rename(staging, destination);
  } catch (error) {
    logger.warn(`Could not stage job ${job.id}`, error);
    return false;
  }

  // Remove every other copy so the job is in exactly one state.
  for (const state of JOB_STATES) {
    if (state === to) continue;
    try {
      await fs.promises.rm(
        path.join(stateDirectory(vaultPath, state), fileName),
        {
          force: true,
        },
      );
    } catch {
      // Nothing there.
    }
  }
  return true;
}

/**
 * Takes the next job that is due, moving it to Processing.
 *
 * Returns null when nothing is ready — either the queue is empty or every
 * waiting job is still inside its backoff window.
 */
export async function claimNextJob(
  vaultPath: string,
  now = Date.now(),
): Promise<MemoryJob | null> {
  await ensureJobDirectories(vaultPath);
  for (const job of listJobs(vaultPath, "Pending")) {
    if (job.next_attempt_at != null && job.next_attempt_at > now) continue;
    const claimed: MemoryJob = { ...job, attempts: job.attempts + 1 };
    if (await moveJob(vaultPath, claimed, "Processing")) {
      return { ...claimed, status: "processing" };
    }
  }
  return null;
}

export async function completeJob(
  vaultPath: string,
  job: MemoryJob,
): Promise<void> {
  await moveJob(vaultPath, job, "Completed", { last_error: undefined });
}

/**
 * Records a failed attempt.
 *
 * Below the attempt limit the job returns to Pending with a backoff; at the
 * limit it moves to Failed, where it stays readable and can be retried by
 * hand rather than disappearing.
 */
export async function failJob(
  vaultPath: string,
  job: MemoryJob,
  reason: string,
  now = Date.now(),
): Promise<JobState> {
  if (job.attempts >= MAX_ATTEMPTS) {
    await moveJob(vaultPath, job, "Failed", { last_error: reason });
    logger.warn(`Memory job ${job.id} failed permanently: ${reason}`);
    return "Failed";
  }
  await moveJob(vaultPath, job, "Pending", {
    last_error: reason,
    next_attempt_at: now + backoffMs(job.attempts),
  });
  return "Pending";
}

/** Puts a failed job back in the queue, with its attempt count cleared. */
export async function retryFailedJob(
  vaultPath: string,
  contentHash: string,
): Promise<boolean> {
  const job = listJobs(vaultPath, "Failed").find(
    (candidate) => candidate.content_hash === contentHash,
  );
  if (!job) return false;
  return moveJob(vaultPath, { ...job, attempts: 0 }, "Pending", {
    next_attempt_at: undefined,
    last_error: undefined,
  });
}

export function jobCounts(vaultPath: string): Record<JobState, number> {
  return {
    Pending: listJobs(vaultPath, "Pending").length,
    Processing: listJobs(vaultPath, "Processing").length,
    Completed: listJobs(vaultPath, "Completed").length,
    Failed: listJobs(vaultPath, "Failed").length,
  };
}
