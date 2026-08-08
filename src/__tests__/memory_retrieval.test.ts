import { describe, expect, it } from "vitest";

import {
  classifyMemoryPath,
  detectEntities,
  dropOverlapping,
  matchesEntity,
  recencyBoost,
  scoreMemory,
  type ScorableMemory,
} from "@/ipc/utils/memory_retrieval";
import type { RetrievedMemory } from "@/ipc/utils/memory_context";

describe("classifyMemoryPath", () => {
  it("reads the kind from where the file lives", () => {
    expect(classifyMemoryPath("Memory/Projects/MetaHuman OS.md").kind).toBe(
      "project-memory",
    );
    expect(classifyMemoryPath("Memory/People/Tiffany.md").kind).toBe("person");
    expect(
      classifyMemoryPath("Memory/Long Term Memory/Preferences.md").kind,
    ).toBe("long-term");
    expect(classifyMemoryPath("Memory/Summaries/x.md").kind).toBe(
      "conversation-summary",
    );
    expect(classifyMemoryPath("Memory/Conversations/x.md").kind).toBe(
      "conversation",
    );
  });

  it("takes the project and person name from the file name", () => {
    expect(classifyMemoryPath("Memory/Projects/MetaHuman OS.md").project).toBe(
      "MetaHuman OS",
    );
    expect(classifyMemoryPath("Memory/People/Tiffany.md").person).toBe(
      "Tiffany",
    );
  });

  it("handles Windows separators", () => {
    expect(
      classifyMemoryPath(String.raw`Memory\Projects\MetaHuman OS.md`).kind,
    ).toBe("project-memory");
  });
});

describe("detectEntities", () => {
  it("finds capitalised names", () => {
    const entities = detectEntities("How is MetaHuman OS going?");
    expect(entities).toContain("metahuman os");
  });

  it("finds quoted phrases", () => {
    expect(detectEntities('remember the "low visibility" notes')).toContain(
      "low visibility",
    );
  });

  it("returns nothing for a message with no names", () => {
    expect(detectEntities("what do you think about that?")).toEqual([]);
  });
});

describe("matchesEntity", () => {
  const memory = { project: "MetaHuman OS", person: null, content: "x" };

  it("matches a project the user just named", () => {
    expect(matchesEntity(memory, ["metahuman os"])).toBe(true);
  });

  it("does not match an unrelated name", () => {
    expect(matchesEntity(memory, ["helix"])).toBe(false);
  });

  it("is false when nothing was named", () => {
    expect(matchesEntity(memory, [])).toBe(false);
  });
});

describe("recencyBoost", () => {
  const now = Date.parse("2026-08-04T00:00:00.000Z");

  it("rewards a memory updated today", () => {
    expect(recencyBoost("2026-08-04T00:00:00.000Z", now)).toBeGreaterThan(0.1);
  });

  it("has largely decayed after a year", () => {
    expect(recencyBoost("2025-08-04T00:00:00.000Z", now)).toBeLessThan(0.01);
  });

  it("ignores a missing or unreadable date", () => {
    expect(recencyBoost(undefined, now)).toBe(0);
    expect(recencyBoost("not a date", now)).toBe(0);
  });
});

describe("scoreMemory", () => {
  const base: ScorableMemory = {
    kind: "conversation",
    project: null,
    person: null,
    content: "text",
    similarity: 0.5,
  };
  const context = { entities: [] as string[], now: Date.now() };

  it("ranks a project memory above an equally similar old chat", () => {
    const project = scoreMemory({ ...base, kind: "project-memory" }, context);
    expect(project).toBeGreaterThan(scoreMemory(base, context));
  });

  it("rewards naming what the user just named", () => {
    const named = scoreMemory(
      { ...base, project: "MetaHuman OS" },
      { ...context, entities: ["metahuman os"] },
    );
    expect(named).toBeGreaterThan(scoreMemory(base, context));
  });

  it("gives the active project the strongest lift", () => {
    const active = scoreMemory(
      { ...base, project: "MetaHuman OS" },
      { ...context, activeProject: "MetaHuman OS" },
    );
    const other = scoreMemory(
      { ...base, project: "Something Else" },
      { ...context, activeProject: "MetaHuman OS" },
    );
    expect(active).toBeGreaterThan(other);
  });

  it("matches the active project regardless of case", () => {
    const score = scoreMemory(
      { ...base, project: "metahuman os" },
      { ...context, activeProject: "MetaHuman OS" },
    );
    expect(score).toBeGreaterThan(scoreMemory(base, context));
  });

  it("still lets similarity matter within a kind", () => {
    const high = scoreMemory({ ...base, similarity: 0.9 }, context);
    const low = scoreMemory({ ...base, similarity: 0.1 }, context);
    expect(high).toBeGreaterThan(low);
  });
});

describe("dropOverlapping", () => {
  const memory = (over: Partial<RetrievedMemory>): RetrievedMemory => ({
    kind: "conversation",
    sourcePath: "Memory/Conversations/a.md",
    content: "text",
    score: 0.5,
    ...over,
  });

  it("removes a chunk contained in a higher-ranked one from the same file", () => {
    const kept = dropOverlapping([
      memory({ content: "The user prefers local models for privacy." }),
      memory({ content: "prefers local models" }),
    ]);
    expect(kept).toHaveLength(1);
  });

  it("keeps similar text from different files", () => {
    // Two sources agreeing is corroboration, not redundancy.
    const kept = dropOverlapping([
      memory({ content: "prefers local models", sourcePath: "a.md" }),
      memory({ content: "prefers local models", sourcePath: "b.md" }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it("keeps distinct passages from the same file", () => {
    const kept = dropOverlapping([
      memory({ content: "Uses Electron and Vite." }),
      memory({ content: "Ships a bundled Qdrant." }),
    ]);
    expect(kept).toHaveLength(2);
  });
});
