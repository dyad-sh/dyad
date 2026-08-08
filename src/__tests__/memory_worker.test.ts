import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron-log", () => ({
  default: { scope: () => ({ warn: vi.fn(), log: vi.fn(), error: vi.fn() }) },
}));

/** Indexing is derived state; the worker must not depend on it succeeding. */
const indexVectorPaths = vi.fn(async () => []);
vi.mock("@/ipc/utils/vector_workspace", () => ({
  indexVectorPaths: (...args: unknown[]) => indexVectorPaths(...(args as [])),
  createVectorCollection: vi.fn(),
  listVectorCollections: () => [{ id: "col-1", name: "AI Memory" }],
  listVectorSources: () => [],
  removeVectorSource: vi.fn(),
  searchVectorWorkspace: vi.fn(),
}));

const { enqueueJob, claimNextJob, listJobs } =
  await import("@/ipc/utils/memory_jobs");
const { processJob, runWorker, parseConversationTurns, validateExtraction } =
  await import("@/ipc/utils/memory_worker");
const { readBlockField, listBlockIds } =
  await import("@/ipc/utils/memory_blocks");

let vault: string;

beforeEach(() => {
  vault = fs.mkdtempSync(path.join(os.tmpdir(), "memory-worker-"));
  indexVectorPaths.mockClear();
  indexVectorPaths.mockResolvedValue([]);
});

afterEach(() => {
  fs.rmSync(vault, { recursive: true, force: true });
});

const CONVERSATION = [
  "---",
  "id: conv-1",
  "type: conversation",
  "---",
  "",
  "# Chat",
  "",
  "## User",
  "",
  "I prefer running LLMs on my own Mac. We've decided to use Drizzle.",
  "",
  "## Assistant",
  "",
  "Good choice. I'd suggest you also use Postgres.",
  "",
].join("\n");

function seedConversation(contents = CONVERSATION): string {
  const relative = "Memory/Conversations/2026-08-05_10-00_chat.md";
  const full = path.join(vault, relative);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, contents);
  return relative;
}

async function queueOne(contents = CONVERSATION) {
  const relative = seedConversation(contents);
  await enqueueJob(vault, {
    conversationId: "conv-1",
    conversationPath: relative,
    content: contents,
  });
  return relative;
}

const longTerm = (file: string) =>
  fs.readFileSync(path.join(vault, "Memory/Long Term Memory", file), "utf8");

describe("parseConversationTurns", () => {
  it("reads speakers back out of a saved conversation", () => {
    const turns = parseConversationTurns(CONVERSATION);
    expect(turns.map((t) => t.role)).toEqual(["user", "assistant"]);
    expect(turns[0]!.content).toContain("I prefer running LLMs");
  });

  it("ignores the front matter", () => {
    expect(parseConversationTurns(CONVERSATION)[0]!.content).not.toContain(
      "type: conversation",
    );
  });
});

describe("validateExtraction", () => {
  const good = {
    category: "preference" as const,
    statement: "I prefer pnpm",
    provenance: {
      sourceConversation: "c",
      sourceMessageId: "m",
      createdAt: "2026-08-05",
      lastConfirmedAt: "2026-08-05",
      confidence: 0.75,
      status: "active" as const,
    },
  };

  it("accepts a well-formed item", () => {
    expect(validateExtraction([good]).valid).toHaveLength(1);
  });

  it("rejects an item with no traceable source", () => {
    // A claim nobody can check later should never reach a file.
    const orphan = {
      ...good,
      provenance: { ...good.provenance, sourceMessageId: "" },
    };
    expect(validateExtraction([orphan]).valid).toHaveLength(0);
  });

  it("rejects an unsupported category", () => {
    const odd = { ...good, category: "nonsense" as never };
    expect(validateExtraction([odd]).valid).toHaveLength(0);
  });

  it("rejects an impossible confidence", () => {
    const wrong = {
      ...good,
      provenance: { ...good.provenance, confidence: 5 },
    };
    expect(validateExtraction([wrong]).valid).toHaveLength(0);
  });

  it("rejects an empty statement", () => {
    expect(
      validateExtraction([{ ...good, statement: "  " }]).valid,
    ).toHaveLength(0);
  });
});

describe("processJob", () => {
  it("writes the user's statements into long-term memory", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    const outcome = await processJob(vault, job!);

    expect(outcome.status).toBe("completed");
    expect(longTerm("Preferences.md")).toContain("I prefer running LLMs");
    expect(longTerm("Decisions.md")).toContain("decided to use Drizzle");
  });

  it("never turns the assistant's suggestion into a user fact", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    await processJob(vault, job!);

    const all = fs
      .readdirSync(path.join(vault, "Memory/Long Term Memory"))
      .map((file) => longTerm(file))
      .join("\n");
    expect(all).not.toContain("Postgres");
  });

  it("writes a summary carrying the source hash", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    await processJob(vault, job!);

    const summary = fs.readFileSync(
      path.join(vault, "Memory/Summaries/conv-1.md"),
      "utf8",
    );
    expect(summary).toContain("type: conversation-summary");
    expect(summary).toContain("authority: generated-summary");
    expect(summary).toContain(job!.content_hash);
  });

  it("is idempotent when replayed", async () => {
    // Re-running a job must leave the vault identical, not doubled.
    await queueOne();
    const first = await claimNextJob(vault);
    await processJob(vault, first!);
    const after = longTerm("Preferences.md");

    await enqueueJob(vault, {
      conversationId: "conv-1",
      conversationPath: "Memory/Conversations/2026-08-05_10-00_chat.md",
      content: `${CONVERSATION} `,
    });
    const second = await claimNextJob(vault);
    await processJob(vault, second!);

    expect(listBlockIds(longTerm("Preferences.md"))).toHaveLength(
      listBlockIds(after).length,
    );
  });

  it("does not rewrite a summary when the conversation is unchanged", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    await processJob(vault, job!);
    const summaryPath = path.join(vault, "Memory/Summaries/conv-1.md");
    const before = fs.readFileSync(summaryPath, "utf8");

    const outcome = await processJob(vault, { ...job!, id: "again" });
    expect(fs.readFileSync(summaryPath, "utf8")).toBe(before);
    expect(outcome.changedFiles).not.toContain(summaryPath);
  });

  it("preserves text the user wrote by hand", async () => {
    const target = path.join(vault, "Memory/Long Term Memory/Preferences.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# Preferences\n\nMy own note.\n");

    await queueOne();
    const job = await claimNextJob(vault);
    await processJob(vault, job!);

    expect(longTerm("Preferences.md")).toContain("My own note.");
  });

  it("keeps a backup before replacing a living file", async () => {
    const target = path.join(vault, "Memory/Long Term Memory/Preferences.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "# Preferences\n\nOriginal.\n");

    await queueOne();
    const job = await claimNextJob(vault);
    await processJob(vault, job!);

    expect(fs.readFileSync(`${target}.bak`, "utf8")).toContain("Original.");
  });

  it("stamps provenance the user can check", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    await processJob(vault, job!);

    const document = longTerm("Preferences.md");
    const [id] = listBlockIds(document);
    expect(readBlockField(document, id!, "Source conversation")).toBe("conv-1");
    expect(readBlockField(document, id!, "Authority")).toBe("direct-user");
    expect(readBlockField(document, id!, "Status")).toBe("active");
  });

  it("completes rather than retrying when the conversation is gone", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    fs.rmSync(path.join(vault, job!.conversation_path));

    const outcome = await processJob(vault, job!);
    expect(outcome.status).toBe("skipped");
    expect(listJobs(vault, "Completed")).toHaveLength(1);
  });

  it("keeps the Markdown when indexing fails", async () => {
    // Qdrant being down must never undo a durable write.
    indexVectorPaths.mockRejectedValueOnce(new Error("qdrant offline"));
    await queueOne();
    const job = await claimNextJob(vault);

    const outcome = await processJob(vault, job!);

    expect(outcome.status).toBe("completed");
    expect(outcome.indexed).toBe(false);
    expect(longTerm("Preferences.md")).toContain("I prefer running LLMs");
  });

  it("re-indexes only the files it changed", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    const outcome = await processJob(vault, job!);

    expect(indexVectorPaths).toHaveBeenCalledTimes(1);
    const [, paths] = indexVectorPaths.mock.calls[0] as unknown as [
      string,
      string[],
    ];
    expect(paths).toEqual(outcome.changedFiles);
    expect(paths.every((p) => p.includes("Memory"))).toBe(true);
  });

  it("changes nothing in dry-run mode", async () => {
    await queueOne();
    const job = await claimNextJob(vault);
    const outcome = await processJob(vault, job!, { dryRun: true });

    expect(outcome.changedFiles.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(vault, "Memory/Long Term Memory"))).toBe(
      false,
    );
    expect(indexVectorPaths).not.toHaveBeenCalled();
  });
});

describe("runWorker", () => {
  it("drains the queue and completes the jobs", async () => {
    await queueOne();
    const outcomes = await runWorker(vault);

    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]!.status).toBe("completed");
    expect(listJobs(vault, "Pending")).toHaveLength(0);
    expect(listJobs(vault, "Completed")).toHaveLength(1);
  });

  it("stops immediately when cancelled for shutdown", async () => {
    await queueOne();
    const outcomes = await runWorker(vault, { signal: { aborted: true } });

    expect(outcomes).toEqual([]);
    expect(listJobs(vault, "Pending")).toHaveLength(1);
  });

  it("caps how much of a backlog one pass takes", async () => {
    for (let index = 0; index < 5; index += 1) {
      const relative = seedConversation(`${CONVERSATION}\n<!-- ${index} -->`);
      await enqueueJob(vault, {
        conversationId: `conv-${index}`,
        conversationPath: relative,
        content: `${CONVERSATION}${index}`,
      });
    }

    const outcomes = await runWorker(vault, { maxJobs: 2 });
    expect(outcomes).toHaveLength(2);
    expect(listJobs(vault, "Pending")).toHaveLength(3);
  });

  it("does nothing when the queue is empty", async () => {
    expect(await runWorker(vault)).toEqual([]);
  });
});
