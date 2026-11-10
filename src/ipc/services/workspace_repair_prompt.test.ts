import { describe, expect, it, vi } from "vitest";

vi.mock("@/db", () => ({ db: {} }));

import { buildConflictDiffSections } from "./workspace_repair_prompt";

describe("buildConflictDiffSections", () => {
  it("keeps every file's diffs within the total budget", async () => {
    const files = Array.from(
      { length: 8 },
      (_, index) => `src/file${index}.ts`,
    );
    const readDiffs = vi.fn(async (file: string) => ({
      ours: `+ours ${file}\n`.repeat(1_000),
      theirs: `+theirs ${file}\n`.repeat(1_000),
    }));

    const sections = await buildConflictDiffSections({
      files,
      targetBranch: "main",
      label: (file) => file,
      readDiffs,
    });

    const note = sections.at(-1)!;
    const diffSections = sections.slice(0, -1);
    expect(diffSections.join("").length).toBeLessThanOrEqual(20_000);
    // Each shown section still closes its code blocks.
    for (const section of diffSections) {
      expect(section.endsWith("```")).toBe(true);
      expect(section.match(/```/g)).toHaveLength(4);
    }
    // Files that did not fit are named, and their diffs are never read.
    expect(note).toContain("src/file7.ts");
    expect(note).toContain("read those files directly");
    expect(readDiffs).toHaveBeenCalledTimes(diffSections.length);
  });
});
