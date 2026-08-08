import { describe, expect, it } from "vitest";

import {
  categorise,
  confidenceFor,
  extractMemories,
  isExtractable,
  resolveConflict,
  splitSentences,
  type SourceMessage,
} from "@/ipc/utils/memory_extraction";

const user = (content: string, id = "m1"): SourceMessage => ({
  id,
  role: "user",
  content,
});
const assistant = (content: string, id = "m2"): SourceMessage => ({
  id,
  role: "assistant",
  content,
});

describe("isExtractable — what may become a memory", () => {
  it("accepts a user statement", () => {
    expect(isExtractable(user("I prefer local models."))).toBe(true);
  });

  it("never extracts from the assistant", () => {
    // The model proposing something is not the user adopting it. This is the
    // rule that stops the vault filling with our own suggestions.
    expect(isExtractable(assistant("You should use Postgres for this."))).toBe(
      false,
    );
  });

  it("never re-extracts retrieved memory", () => {
    // Otherwise the vault would amplify its own guesses into certainties.
    expect(
      isExtractable(user("<retrieved_memory>\nI prefer local models.\n")),
    ).toBe(false);
  });

  it("ignores greetings and acknowledgements", () => {
    for (const text of ["hi", "thanks!", "ok", "sure", "great"]) {
      expect(isExtractable(user(text))).toBe(false);
    }
  });

  it("ignores a passing request about the current reply", () => {
    expect(isExtractable(user("make that shorter"))).toBe(false);
  });

  it("ignores a plain question", () => {
    expect(isExtractable(user("what is a vector database?"))).toBe(false);
  });

  it("still accepts a question that asks to be remembered", () => {
    expect(isExtractable(user("can you remember that I prefer Vitest?"))).toBe(
      true,
    );
  });

  it("ignores an empty message", () => {
    expect(isExtractable(user("   "))).toBe(false);
  });
});

describe("categorise", () => {
  it("recognises a stable preference", () => {
    expect(categorise("I prefer running models locally")).toBe("preference");
  });

  it("recognises a decision", () => {
    expect(categorise("we've decided to use Drizzle")).toBe("decision");
  });

  it("recognises a goal", () => {
    expect(categorise("I want to ship this by December")).toBe("goal");
  });

  it("recognises a dated commitment", () => {
    expect(categorise("the deadline is next Friday")).toBe("timeline");
  });

  it("returns nothing for ordinary conversation", () => {
    expect(categorise("that makes sense to me")).toBeNull();
  });
});

describe("extractMemories", () => {
  const context = { conversationId: "conv-1", now: "2026-08-05T00:00:00.000Z" };

  it("keeps the user's own wording as the record", () => {
    const [memory] = extractMemories(
      [user("I prefer running LLMs on my own Mac")],
      context,
    );
    expect(memory!.statement).toBe("I prefer running LLMs on my own Mac");
    expect(memory!.category).toBe("preference");
  });

  it("stamps provenance on everything durable", () => {
    const [memory] = extractMemories(
      [user("I prefer Vitest", "msg-7")],
      context,
    );
    expect(memory!.provenance).toMatchObject({
      sourceConversation: "conv-1",
      sourceMessageId: "msg-7",
      createdAt: "2026-08-05T00:00:00.000Z",
      lastConfirmedAt: "2026-08-05T00:00:00.000Z",
      status: "active",
    });
    expect(memory!.provenance.confidence).toBeGreaterThan(0);
  });

  it("does not turn an assistant suggestion into a user fact", () => {
    const memories = extractMemories(
      [
        assistant("I'd suggest you use Postgres. We've decided to use it."),
        user("hmm"),
      ],
      context,
    );
    expect(memories).toEqual([]);
  });

  it("drops speculation the user never adopted", () => {
    expect(
      extractMemories([user("maybe I'll use Postgres for this")], context),
    ).toEqual([]);
  });

  it("keeps speculation the user asked to be remembered", () => {
    const memories = extractMemories(
      [user("remember that I might move to Postgres")],
      context,
    );
    expect(memories).toHaveLength(1);
    // Recorded, but trusted less than a plain statement.
    expect(memories[0]!.provenance.confidence).toBeLessThan(0.95);
  });

  it("refuses to infer sensitive attributes", () => {
    expect(
      extractMemories(
        [user("I always vote for the green party at elections")],
        context,
      ),
    ).toEqual([]);
  });

  it("pulls several statements out of one message", () => {
    const memories = extractMemories(
      [user("I prefer dark themes. We've decided to use Drizzle.")],
      context,
    );
    expect(memories.map((m) => m.category).sort()).toEqual([
      "decision",
      "preference",
    ]);
  });

  it("returns nothing for a conversation with nothing durable in it", () => {
    expect(
      extractMemories(
        [user("hey"), assistant("Hello!"), user("what time is it?")],
        context,
      ),
    ).toEqual([]);
  });
});

describe("confidenceFor", () => {
  it("trusts an explicit instruction most", () => {
    expect(confidenceFor("remember this: I use pnpm")).toBeGreaterThan(0.9);
  });

  it("trusts hedged wording least", () => {
    expect(confidenceFor("I might use pnpm")).toBeLessThan(
      confidenceFor("I use pnpm"),
    );
  });
});

describe("splitSentences", () => {
  it("splits on sentence endings", () => {
    expect(splitSentences("One thing. Another thing.")).toEqual([
      "One thing",
      "Another thing",
    ]);
  });

  it("does not split on a common abbreviation", () => {
    expect(splitSentences("Use a local model, e.g. nomic, for this")).toEqual([
      "Use a local model, e.g. nomic, for this",
    ]);
  });
});

describe("resolveConflict", () => {
  const claim = (
    over: Partial<Parameters<typeof resolveConflict>[0]> = {},
  ) => ({
    source: "extracted-long-term",
    statement: "uses Postgres",
    updatedAt: "2026-01-01T00:00:00.000Z",
    confidence: 0.7,
    ...over,
  });

  it("never lets a generated summary overwrite a newer user statement", () => {
    // The rule that protects the user's own words from our paraphrases.
    const summary = claim({
      source: "generated-summary",
      updatedAt: "2026-08-01T00:00:00.000Z",
    });
    const statement = claim({
      source: "recent-user-statement",
      updatedAt: "2026-07-01T00:00:00.000Z",
    });
    expect(resolveConflict(summary, statement).winner).toBe(statement);
  });

  it("prefers the more authoritative source", () => {
    const manual = claim({ source: "manually-edited" });
    const raw = claim({ source: "raw-conversation" });
    expect(resolveConflict(raw, manual).winner).toBe(manual);
  });

  it("prefers the newer of two equally authoritative claims", () => {
    const older = claim({ updatedAt: "2026-01-01T00:00:00.000Z" });
    const newer = claim({ updatedAt: "2026-08-01T00:00:00.000Z" });
    expect(resolveConflict(older, newer).winner).toBe(newer);
  });

  it("falls back to confidence when authority and time tie", () => {
    const unsure = claim({ confidence: 0.4 });
    const sure = claim({ confidence: 0.9 });
    expect(resolveConflict(unsure, sure).winner).toBe(sure);
  });

  it("leaves a genuine tie unresolved rather than blending them", () => {
    // Silently merging two incompatible facts is worse than admitting the
    // conflict and asking a human.
    const result = resolveConflict(claim(), claim({ statement: "uses MySQL" }));
    expect(result.winner).toBeNull();
    expect(result.reason).toMatch(/equally/i);
  });
});
