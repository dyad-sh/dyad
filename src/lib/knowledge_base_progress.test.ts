import { describe, expect, it } from "vitest";

import { knowledgeBaseProgressPercent } from "./knowledge_base_progress";

describe("knowledgeBaseProgressPercent", () => {
  it("reports the indexed share while idle", () => {
    expect(
      knowledgeBaseProgressPercent({
        progress: null,
        isAdding: false,
        documentCount: 3,
        pendingCount: 1,
      }),
    ).toBe(75);
  });

  it("reserves the first quarter of an add operation for uploading", () => {
    expect(
      knowledgeBaseProgressPercent({
        progress: {
          phase: "uploading",
          completedCount: 0,
          totalCount: 2,
          completedBytes: 50,
          totalBytes: 100,
        },
        isAdding: true,
        documentCount: 0,
        pendingCount: 0,
      }),
    ).toBe(13);
  });

  it("finishes the remaining progress while indexing", () => {
    expect(
      knowledgeBaseProgressPercent({
        progress: {
          phase: "indexing",
          completedCount: 3,
          totalCount: 4,
        },
        isAdding: true,
        documentCount: 0,
        pendingCount: 0,
      }),
    ).toBe(81);
  });
});
