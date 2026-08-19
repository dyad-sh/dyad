import { describe, expect, it } from "vitest";

import {
  selectedDataSourceTurnGuidance,
  shouldMutateSelectedDataSource,
  shouldPreferSelectedDataSources,
  shouldRequireSelectedDataSourceRows,
} from "./chat_agent_data_source_intent";

describe("selected data-source routing", () => {
  it("routes explicit private-source requests to the selected database", () => {
    expect(
      shouldPreferSelectedDataSources([
        { role: "user", content: "Reference my OSINT source." },
      ]),
    ).toBe(true);
  });

  it("keeps the selected source for a short follow-up", () => {
    expect(
      shouldPreferSelectedDataSources([
        { role: "user", content: "Use my OSINT database." },
        { role: "assistant", content: "What should I find?" },
        { role: "user", content: "Tell me about Geoff Robison from VMC." },
      ]),
    ).toBe(true);
  });

  it("recognises structured record questions without source wording", () => {
    const messages = [
      { role: "user" as const, content: "What are my latest orders?" },
    ];
    expect(shouldPreferSelectedDataSources(messages)).toBe(true);
    expect(shouldRequireSelectedDataSourceRows(messages)).toBe(true);
    expect(selectedDataSourceTurnGuidance(messages)).toContain(
      "Do not ask for an email",
    );
  });

  it("does not treat latest business orders as the speaker's purchases", () => {
    const guidance = selectedDataSourceTurnGuidance([
      { role: "user", content: "Show our 10 most recent orders" },
    ]);
    expect(guidance).toContain("selected business database");
    expect(guidance).toContain("query up to 10 rows");
  });

  it("keeps an explicitly personal purchase lookup identity-scoped", () => {
    expect(
      selectedDataSourceTurnGuidance([
        { role: "user", content: "Show the latest orders I placed" },
      ]),
    ).toBeNull();
  });

  it("does not force a row query for a schema-only request", () => {
    expect(
      shouldRequireSelectedDataSourceRows([
        { role: "user", content: "What tables are in my database?" },
      ]),
    ).toBe(false);
  });

  it("recognises an explicit request to modify a selected record", () => {
    expect(
      shouldMutateSelectedDataSource([
        {
          role: "user",
          content:
            "Add a new investigation record to my OSINT database with codename GayBlade.",
        },
      ]),
    ).toBe(true);
    expect(
      shouldMutateSelectedDataSource([
        { role: "user", content: "Show my latest investigation records." },
      ]),
    ).toBe(false);
  });

  it("does not divert ordinary public research into a selected database", () => {
    expect(
      shouldPreferSelectedDataSources([
        { role: "user", content: "What is the weather in Brisbane?" },
      ]),
    ).toBe(false);
  });
});
