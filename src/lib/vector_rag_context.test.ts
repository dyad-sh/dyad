import { describe, expect, it } from "vitest";

import {
  buildVectorRetrievalQuery,
  excludePrivateMemoryVectorPassages,
  filterRelevantVectorPassages,
  formatVectorKnowledgeContext,
  isDocumentSurveyQuery,
  scoreDocumentSurveyPassage,
} from "./vector_rag_context";

describe("vector RAG context", () => {
  it("keeps private memory files out of document evidence and source cards", () => {
    const passages = [
      {
        sourcePath: "/Volumes/Vault/Memory/Long Term Memory/Important Facts.md",
        content: "The user's name is Tiago.",
      },
      {
        sourcePath: "/Volumes/Vault/Memory/Conversations/old-chat.md",
        content: "A previous private conversation.",
      },
      {
        sourcePath: "/Volumes/Vault/Documents/Flight Manual.pdf",
        content: "Documentary evidence.",
      },
    ];

    expect(excludePrivateMemoryVectorPassages(passages)).toEqual([passages[2]]);
  });

  it("keeps earlier subject matter for an ambiguous follow-up", () => {
    const query = buildVectorRetrievalQuery([
      {
        role: "user",
        content: "Which companies quoted for the top balconies at VMC?",
      },
      {
        role: "assistant",
        content:
          "Mend Building, Remedial Building Services and Coast Remedial Solutions.",
      },
      { role: "user", content: "Break down each quote." },
    ]);

    expect(query).toContain("top balconies at VMC");
    expect(query).not.toContain("Mend Building");
    expect(query).toContain("Break down each quote");
  });

  it("does not feed a previous incorrect assistant answer back into search", () => {
    const query = buildVectorRetrievalQuery([
      { role: "user", content: "How many providers quoted?" },
      {
        role: "assistant",
        content: "Only one provider quoted: Remedial.",
      },
      { role: "user", content: "But there are three quotes in the document." },
    ]);

    expect(query).not.toContain("Only one provider");
    expect(query).toContain("How many providers quoted");
    expect(query).toContain("three quotes in the document");
  });

  it("does not carry an old tender topic into a new aviation question", () => {
    const query = buildVectorRetrievalQuery([
      { role: "user", content: "Summarise the Buildcheck tender." },
      { role: "assistant", content: "Here is the tender summary." },
      { role: "user", content: "What is CAT 3 visibility?" },
    ]);

    expect(query).not.toContain("Buildcheck tender");
    expect(query).toContain("CAT 3 visibility");
  });

  it("rejects unrelated retrieval candidates before citation", () => {
    const passages = [
      {
        sourceId: "tender",
        sourceName: "Buildcheck Tender Summary.pdf",
        content: "Category 3 waterproofing works and contractor pricing.",
      },
      {
        sourceId: "aviation",
        sourceName: "ILS Operations.pdf",
        content:
          "ILS CAT III operations use runway visual range (RVR) minima in low visibility.",
      },
      {
        sourceId: "aviation",
        sourceName: "ILS Operations.pdf",
        content: "Fail-operational autoland requirements continue on page 2.",
      },
    ];

    expect(
      filterRelevantVectorPassages("What is CAT 3 visibility?", passages),
    ).toEqual(passages.slice(1));
  });

  it("recognises broad count questions and favours document-wide evidence", () => {
    const query = "How many providers quoted?";
    const overview = [
      "Tender Summary",
      "The scope was sent to the following contractors:",
      "Mend Building, Remedial Building Services, Coast Remedial Solutions.",
      "All three contractors submitted their respective tenders.",
    ].join("\n");
    const singlePartyClarification = [
      "Tender Clarifications",
      "This quotation is firm for thirty days.",
      "Remedial have allowed for an average screed thickness.",
    ].join("\n");

    expect(isDocumentSurveyQuery(query)).toBe(true);
    expect(scoreDocumentSurveyPassage(query, overview)).toBeGreaterThan(
      scoreDocumentSurveyPassage(query, singlePartyClarification),
    );
  });

  it("favours priced tables when asked to break down quotes", () => {
    const query = "Break down each quote provided by each company";
    const pricedSchedule = [
      "| Scope | North Build | South Build |",
      "|---|---:|---:|",
      "| Waterproofing | $625,380.00 | $558,000.00 |",
      "| Sliding doors | $136,810.00 | $99,500.00 |",
    ].join("\n");
    const narrative =
      "The tender analysis compares the contractors and discusses their submissions.";

    expect(scoreDocumentSurveyPassage(query, pricedSchedule)).toBeGreaterThan(
      scoreDocumentSurveyPassage(query, narrative),
    );
  });

  it("removes previously injected private context from the search query", () => {
    const query = buildVectorRetrievalQuery([
      {
        role: "user",
        content:
          "<retrieved_memory>secret memory</retrieved_memory>\nWhat did the tender cost?",
      },
    ]);

    expect(query).not.toContain("secret memory");
    expect(query).toContain("What did the tender cost?");
  });

  it("requires citations only for passages actually used", () => {
    const context = formatVectorKnowledgeContext([
      {
        sourceName: "Buildcheck Tender Summary.pdf",
        page: 3,
        content: "Total Cost: $1,277,000.00",
      },
    ]);

    expect(context).toContain(
      "[Source 1: Buildcheck Tender Summary.pdf, page 3]",
    );
    expect(context).toContain("CITATIONS ARE REQUIRED FOR EVERY PASSAGE");
    expect(context).toContain("**Sources consulted**");
    expect(context).toContain("only when at least one retrieved");
    expect(context).toContain("do not cite them");
  });
});
