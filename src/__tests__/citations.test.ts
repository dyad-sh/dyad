import { describe, expect, it } from "vitest";

import { findCitations, splitByCitations } from "@/lib/citations";

describe("findCitations", () => {
  it("reads the file name and locator the model was told to write", () => {
    const [citation] = findCitations(
      "DH is 50 ft. (LVO Part 1 - CAT II and III General v2.9.pdf, lines 183–250)",
    );
    expect(citation.sourceName).toBe(
      "LVO Part 1 - CAT II and III General v2.9.pdf",
    );
    expect(citation.locator).toBe("lines 183–250");
  });

  it("accepts a citation with no locator", () => {
    const [citation] = findCitations("See (Manual.pdf) for detail.");
    expect(citation.sourceName).toBe("Manual.pdf");
    expect(citation.locator).toBeNull();
  });

  it("extracts an exact PDF page for the document opener", () => {
    const [citation] = findCitations("See (Manual.pdf, page 42).");
    expect(citation.page).toBe(42);
    expect(citation.lineStart).toBeNull();
  });

  it("extracts a text line range for the document opener", () => {
    const [citation] = findCitations("See (notes.md, lines 12–20).");
    expect(citation.page).toBeNull();
    expect(citation.lineStart).toBe(12);
    expect(citation.lineEnd).toBe(20);
  });

  it("finds every citation in a paragraph", () => {
    expect(
      findCitations("A (one.pdf, lines 1–2) and B (two.md, lines 3–4)"),
    ).toHaveLength(2);
  });

  it("ignores ordinary parentheses", () => {
    // Requiring an extension is what keeps prose asides out.
    expect(findCitations("This is fine (see below) and so is (1.5 x)")).toEqual(
      [],
    );
  });

  it("ignores a bare sentence in brackets", () => {
    expect(findCitations("(No decision height applies.)")).toEqual([]);
  });

  it("returns nothing for empty text", () => {
    expect(findCitations("")).toEqual([]);
  });
});

describe("splitByCitations", () => {
  it("keeps the surrounding prose intact and in order", () => {
    const segments = splitByCitations("Before (a.pdf, lines 1–2) after");
    expect(segments.map((s) => s.kind)).toEqual(["text", "citation", "text"]);
    expect(segments[0]).toEqual({ kind: "text", text: "Before " });
    expect(segments[2]).toEqual({ kind: "text", text: " after" });
  });

  it("returns a single run when there is nothing to link", () => {
    const segments = splitByCitations("Plain sentence.");
    expect(segments).toEqual([{ kind: "text", text: "Plain sentence." }]);
  });

  it("handles back-to-back citations without losing text", () => {
    const text = "(a.pdf, lines 1–2)(b.pdf, lines 3–4)";
    const segments = splitByCitations(text);
    expect(segments.filter((s) => s.kind === "citation")).toHaveLength(2);
    // Reassembling must reproduce the original exactly.
    const rebuilt = segments
      .map((s) => (s.kind === "text" ? s.text : s.citation.raw))
      .join("");
    expect(rebuilt).toBe(text);
  });
});
