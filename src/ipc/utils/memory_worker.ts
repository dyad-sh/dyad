/**
 * The worker that turns queued conversations into durable memory.
 *
 * Ordering here is a safety property, not a style choice. Markdown is the
 * source of truth, so it is written first and never rolled back; the vector
 * index is derived, so a failure there is recorded and retried rather than
 * allowed to undo a good write. A job is only Completed once every required
 * durable write has succeeded — indexing is explicitly not one of them.
 *
 * Everything is idempotent. Blocks are keyed by a stable id derived from the
 * statement, so replaying a job updates the same block instead of appending a
 * near-duplicate, and a job that runs twice leaves the vault identical.
 */

import fs from "node:fs";
import path from "node:path";
import log from "electron-log";

import { hashContent } from "./embedding_provider";
import { stableItemId, upsertBlock, type ManagedItem } from "./memory_blocks";
import {
  extractMemories,
  type ExtractedMemory,
  type SourceMessage,
} from "./memory_extraction";
import {
  claimNextJob,
  completeJob,
  failJob,
  jobCounts,
  type MemoryJob,
} from "./memory_jobs";
import { memoryPath } from "./memory_vault";
import { indexVectorPaths } from "./vector_workspace";
import { ensureMemoryCollection } from "./memory_index";

const logger = log.scope("memory_worker");

/** Where each category is written. */
const CATEGORY_FILES: Record<string, string> = {
  preference: "Preferences.md",
  goal: "Goals.md",
  fact: "Important Facts.md",
  decision: "Decisions.md",
  timeline: "Timeline.md",
};

export type WorkerOptions = {
  /** Reports what would change without touching a file. */
  dryRun?: boolean;
  /** Stops the run between jobs, for shutdown. */
  signal?: { aborted: boolean };
  /** Most jobs to process in one pass, so a backlog cannot monopolise. */
  maxJobs?: number;
};

export type JobOutcome = {
  jobId: string;
  status: "completed" | "retried" | "failed" | "skipped";
  changedFiles: string[];
  indexed: boolean;
  reason?: string;
};

/**
 * Writes a file by staging a sibling and renaming over the target, keeping a
 * `.bak` of what was there. A crash mid-write can therefore never leave a
 * memory file truncated.
 */
async function atomicWrite(filePath: string, contents: string): Promise<void> {
  await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
  if (fs.existsSync(filePath)) {
    await fs.promises.copyFile(filePath, `${filePath}.bak`);
  }
  const staging = `${filePath}.tmp`;
  await fs.promises.writeFile(staging, contents, "utf8");
  await fs.promises.rename(staging, filePath);
}

/** The turns of a saved conversation, as the extractor wants them. */
export function parseConversationTurns(markdown: string): SourceMessage[] {
  const body = markdown.replace(/^---[\s\S]*?---\n/, "");
  const messages: SourceMessage[] = [];
  const pattern = /^## (User|Assistant)\s*$/gm;
  const marks = [...body.matchAll(pattern)];

  for (let index = 0; index < marks.length; index += 1) {
    const mark = marks[index]!;
    const start = mark.index! + mark[0].length;
    const end = marks[index + 1]?.index ?? body.length;
    const content = body.slice(start, end).trim();
    if (!content) continue;
    messages.push({
      id: `msg-${index + 1}`,
      role: mark[1] === "User" ? "user" : "assistant",
      content,
    });
  }
  return messages;
}

function titleFor(memory: ExtractedMemory): string {
  const words = memory.statement.trim().split(/\s+/).slice(0, 8).join(" ");
  return words.length < memory.statement.trim().length ? `${words}…` : words;
}

function toManagedItem(memory: ExtractedMemory): ManagedItem {
  const id = stableItemId(memory.category, memory.statement, hashContent);
  return {
    id,
    title: titleFor(memory),
    content: memory.statement,
    sourceConversation: memory.provenance.sourceConversation,
    sourceMessage: memory.provenance.sourceMessageId,
    created: memory.provenance.createdAt,
    lastConfirmed: memory.provenance.lastConfirmedAt,
    confidence: memory.provenance.confidence,
    // Extraction only ever reads the user's own words, so the authority of
    // anything written here is the user, not the assistant.
    authority: "direct-user",
    status: "active",
    tags: [memory.category],
  };
}

/**
 * Checks an extraction result before any file is touched.
 *
 * An item with no traceable source cannot be checked by a human later, so it
 * is dropped rather than written.
 */
export function validateExtraction(memories: ExtractedMemory[]): {
  valid: ExtractedMemory[];
  rejected: number;
} {
  const valid = memories.filter((memory) => {
    if (!memory.statement?.trim()) return false;
    if (!CATEGORY_FILES[memory.category]) return false;
    if (!memory.provenance?.sourceConversation) return false;
    if (!memory.provenance?.sourceMessageId) return false;
    const confidence = memory.provenance.confidence;
    if (typeof confidence !== "number" || confidence <= 0 || confidence > 1) {
      return false;
    }
    return true;
  });
  return { valid, rejected: memories.length - valid.length };
}

/** Writes a conversation summary, skipping the write when nothing changed. */
async function writeSummary(
  vaultPath: string,
  job: MemoryJob,
  memories: ExtractedMemory[],
  dryRun: boolean,
): Promise<string | null> {
  const target = memoryPath(
    vaultPath,
    "Summaries",
    `${job.conversation_id}.md`,
  );

  const section = (title: string, items: string[]) =>
    [
      `## ${title}`,
      "",
      ...(items.length ? items.map((i) => `- ${i}`) : ["- None recorded"]),
      "",
    ].join("\n");

  const byCategory = (category: string) =>
    memories.filter((m) => m.category === category).map((m) => m.statement);

  const contents = [
    "---",
    `id: summary-${job.conversation_id}`,
    "type: conversation-summary",
    `source_conversation: ${job.conversation_id}`,
    `source_hash: ${job.content_hash}`,
    `created: ${new Date().toISOString()}`,
    "authority: generated-summary",
    "tags: []",
    "---",
    "",
    "# Conversation Summary",
    "",
    section("User Preferences", byCategory("preference")),
    section("Decisions", byCategory("decision")),
    section("Goals", byCategory("goal")),
    section("Important Information", byCategory("fact")),
    section("Timeline", byCategory("timeline")),
  ].join("\n");

  // The hash is what makes this a no-op for an unchanged conversation.
  if (fs.existsSync(target)) {
    const existing = await fs.promises.readFile(target, "utf8");
    if (existing.includes(`source_hash: ${job.content_hash}`)) return null;
  }

  if (!dryRun) await atomicWrite(target, contents);
  return target;
}

/** Applies extracted memories to their long-term files. */
async function writeLongTerm(
  vaultPath: string,
  memories: ExtractedMemory[],
  dryRun: boolean,
): Promise<string[]> {
  const byFile = new Map<string, ExtractedMemory[]>();
  for (const memory of memories) {
    const file = CATEGORY_FILES[memory.category];
    if (!file) continue;
    byFile.set(file, [...(byFile.get(file) ?? []), memory]);
  }

  const changed: string[] = [];
  for (const [file, items] of byFile) {
    const target = memoryPath(vaultPath, "Long Term Memory", file);
    const existing = fs.existsSync(target)
      ? await fs.promises.readFile(target, "utf8")
      : `# ${file.replace(/\.md$/, "")}\n\n`;

    let updated = existing;
    for (const memory of items) {
      updated = upsertBlock(updated, toManagedItem(memory));
    }

    // An unchanged file is not rewritten, so mtimes stay meaningful.
    if (updated === existing) continue;
    if (!dryRun) await atomicWrite(target, updated);
    changed.push(target);
  }
  return changed;
}

/**
 * Processes one job.
 *
 * The source conversation going missing is not an error — the user may have
 * deleted it — so the job is completed rather than retried forever.
 */
export async function processJob(
  vaultPath: string,
  job: MemoryJob,
  options: WorkerOptions = {},
): Promise<JobOutcome> {
  const dryRun = options.dryRun ?? false;
  const conversationFile = path.join(vaultPath, job.conversation_path);

  if (!fs.existsSync(conversationFile)) {
    if (!dryRun) await completeJob(vaultPath, job);
    return {
      jobId: job.id,
      status: "skipped",
      changedFiles: [],
      indexed: false,
      reason: "source conversation no longer exists",
    };
  }

  const markdown = await fs.promises.readFile(conversationFile, "utf8");
  const turns = parseConversationTurns(markdown);
  const { valid, rejected } = validateExtraction(
    extractMemories(turns, { conversationId: job.conversation_id }),
  );
  if (rejected > 0) {
    logger.warn(`Discarded ${rejected} untraceable memory item(s)`);
  }

  const changed: string[] = [];
  try {
    const summary = await writeSummary(vaultPath, job, valid, dryRun);
    if (summary) changed.push(summary);
    changed.push(...(await writeLongTerm(vaultPath, valid, dryRun)));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    if (!dryRun) await failJob(vaultPath, job, reason);
    return {
      jobId: job.id,
      status: "retried",
      changedFiles: [],
      indexed: false,
      reason,
    };
  }

  // Markdown is durable now. Indexing is derived, so its failure must not undo
  // the write or block the job — the next save re-indexes anyway.
  let indexed = false;
  if (changed.length > 0 && !dryRun) {
    try {
      const collectionId = await ensureMemoryCollection();
      await indexVectorPaths(collectionId, changed);
      indexed = true;
    } catch (error) {
      logger.warn(
        "Memory written but indexing failed; will retry later",
        error,
      );
    }
  }

  if (!dryRun) await completeJob(vaultPath, job);
  return { jobId: job.id, status: "completed", changedFiles: changed, indexed };
}

/**
 * Drains the queue.
 *
 * Bounded per pass and yielding between jobs, so a large backlog cannot
 * monopolise the process or make the interface stutter.
 */
export async function runWorker(
  vaultPath: string,
  options: WorkerOptions = {},
): Promise<JobOutcome[]> {
  const maxJobs = options.maxJobs ?? 20;
  const outcomes: JobOutcome[] = [];

  for (let processed = 0; processed < maxJobs; processed += 1) {
    if (options.signal?.aborted) break;

    const job = await claimNextJob(vaultPath);
    if (!job) break;

    try {
      outcomes.push(await processJob(vaultPath, job, options));
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const state = await failJob(vaultPath, job, reason);
      outcomes.push({
        jobId: job.id,
        status: state === "Failed" ? "failed" : "retried",
        changedFiles: [],
        indexed: false,
        reason,
      });
    }

    // Give the event loop a turn so the interface stays responsive.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  if (outcomes.length > 0) {
    const counts = jobCounts(vaultPath);
    logger.log(
      `Memory worker processed ${outcomes.length} job(s); ` +
        `${counts.Pending} pending, ${counts.Failed} failed`,
    );
  }
  return outcomes;
}
