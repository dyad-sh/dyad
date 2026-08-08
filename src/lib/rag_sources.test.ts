import { describe, expect, it } from "vitest";

import { collectRagSources, selectCitedRagSources } from "./rag_sources";

const base = {
  collectionId: "knowledge-base",
  collectionName: "Knowledge Base",
  sourceId: "tender",
  sourceName: "Tender Summary.pdf",
  sourcePath: "/vault/Documents/Tender Summary.pdf",
};

describe("collectRagSources", () => {
  it("deduplicates chunks from the same PDF page in retrieval order", () => {
    expect(
      collectRagSources([
        { ...base, page: 4, lineStart: 20, lineEnd: 40 },
        { ...base, page: 4, lineStart: 41, lineEnd: 60 },
        { ...base, page: 7, lineStart: 100, lineEnd: 120 },
      ]),
    ).toEqual([
      { ...base, page: 4, lineStart: null, lineEnd: null },
      { ...base, page: 7, lineStart: null, lineEnd: null },
    ]);
  });

  it("keeps distinct line ranges for text sources", () => {
    const note = {
      ...base,
      sourceId: "notes",
      sourceName: "Meeting notes.md",
      sourcePath: "/vault/Documents/Meeting notes.md",
      page: null,
    };
    expect(
      collectRagSources([
        { ...note, lineStart: 12, lineEnd: 18 },
        { ...note, lineStart: 12, lineEnd: 18 },
        { ...note, lineStart: 30, lineEnd: 32 },
      ]),
    ).toEqual([
      { ...note, lineStart: 12, lineEnd: 18 },
      { ...note, lineStart: 30, lineEnd: 32 },
    ]);
  });
});

describe("selectCitedRagSources", () => {
  const retrieved = [
    { ...base, sourceId: "lvo", sourceName: "LVO General.pdf", page: 5 },
    {
      ...base,
      sourceId: "summary-md",
      sourceName: "Buildcheck Tender Summary.md",
      page: null,
      lineStart: 1,
      lineEnd: 37,
    },
    { ...base, page: 18 },
    { ...base, page: 2 },
    { ...base, sourceId: "lvo", sourceName: "LVO General.pdf", page: 47 },
  ];

  it("matches cards to the exact pages and lines in Sources consulted", () => {
    const answer = `
The fee is not stated (Tender Summary.pdf, page 2). Contractor preliminaries
are separate (Tender Summary.pdf, page 18).

**Sources consulted**
- Tender Summary.pdf, pages 2 and 18
- Buildcheck Tender Summary.md, lines 1–37
`;

    expect(selectCitedRagSources(answer, retrieved)).toEqual([
      retrieved[1],
      retrieved[2],
      retrieved[3],
    ]);
  });

  it("does not treat a nearby locator as belonging to another document", () => {
    const answer =
      "LVO General.pdf was retrieved, but the answer uses Tender Summary.pdf, page 18.";

    expect(selectCitedRagSources(answer, retrieved)).toEqual([retrieved[2]]);
  });

  it("supports markdown-linked source names and page ranges", () => {
    const answer =
      "[Tender Summary.pdf](file:///summary), pages 2–18 contains the relevant schedule.";

    expect(selectCitedRagSources(answer, retrieved)).toEqual([
      retrieved[2],
      retrieved[3],
    ]);
  });
});
