import { describe, expect, it } from "vitest";

import { chunkText, embedLocalText } from "./vector_workspace";

function cosine(left: number[], right: number[]): number {
  return left.reduce(
    (total, value, index) => total + value * (right[index] ?? 0),
    0,
  );
}

describe("local Vector workspace", () => {
  it("creates deterministic, normalized embeddings without a network model", () => {
    const first = embedLocalText("private local vector search");
    const second = embedLocalText("private local vector search");

    expect(first).toEqual(second);
    expect(first).toHaveLength(384);
    expect(cosine(first, first)).toBeCloseTo(1, 5);
  });

  it("ranks shared terms above unrelated text", () => {
    const query = embedLocalText("swift application architecture");
    const related = embedLocalText(
      "application architecture patterns for swift projects",
    );
    const unrelated = embedLocalText("banana recipes and tropical desserts");

    expect(cosine(query, related)).toBeGreaterThan(cosine(query, unrelated));
  });

  it("chunks long text with line-aware source ranges and overlap", () => {
    const source = Array.from(
      { length: 180 },
      (_, index) => `Line ${index + 1}: searchable project documentation.`,
    ).join("\n");
    const chunks = chunkText(source);

    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.lineStart).toBe(1);
    expect(chunks[0]?.lineEnd).toBeGreaterThan(1);
    expect(chunks[1]!.lineStart).toBeLessThanOrEqual(chunks[0]!.lineEnd);
    expect(chunks.at(-1)?.lineEnd).toBe(180);
  });
});
