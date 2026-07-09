import { describe, expect, it } from "vitest";
import { filterRecords, groupByStatus, normalizeSearchTerm } from "./search";

describe("search helpers", () => {
  it("normalizes search terms", () => {
    expect(normalizeSearchTerm("  Atlas  ")).toBe("atlas");
  });

  it("filters typed records by name, title, summary, and tags", () => {
    const rows = [
      { id: "a", name: "Atlas Console", tags: ["core"] },
      { id: "b", title: "Beacon Incident", summary: "billing lane" },
    ];
    expect(filterRecords(rows, "billing")).toEqual([rows[1]]);
    expect(filterRecords(rows, "core")).toEqual([rows[0]]);
  });

  it("groups records by status", () => {
    expect(groupByStatus([{ id: "a", status: "healthy" }, { id: "b", status: "healthy" }, { id: "c", status: "risk" }]).healthy).toHaveLength(2);
  });
});
