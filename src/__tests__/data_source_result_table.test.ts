import { describe, expect, it } from "vitest";

import {
  MAX_TABLE_COLUMNS,
  buildResultTable,
  formatCell,
} from "@/lib/data_sources/result_table";

describe("formatCell", () => {
  it("distinguishes a null from an empty string", () => {
    // The renderer shows one as a dash. An empty cell is ambiguous between
    // "no value" and "failed to render".
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
  });

  it("renders an ISO timestamp as something readable", () => {
    const formatted = formatCell("2026-06-18T22:44:00Z");
    expect(formatted).not.toBe("2026-06-18T22:44:00Z");
    expect(formatted).toMatch(/2026/);
  });

  it("leaves a plain string alone", () => {
    expect(formatCell("confirmed")).toBe("confirmed");
  });

  it("does not mangle a string that merely starts with digits", () => {
    expect(formatCell("2026 budget")).toBe("2026 budget");
  });

  it("compacts a JSON column onto one line", () => {
    expect(formatCell({ a: 1, b: [2] })).toBe('{"a":1,"b":[2]}');
  });

  it("keeps booleans and numbers legible", () => {
    expect(formatCell(false)).toBe("false");
    expect(formatCell(0)).toBe("0");
  });

  it("truncates a runaway value rather than letting it own the row", () => {
    const long = formatCell("x".repeat(5000));
    expect(long.length).toBeLessThan(400);
    expect(long.endsWith("…")).toBe(true);
  });
});

describe("buildResultTable", () => {
  it("keeps column order as the query asked for it", () => {
    const table = buildResultTable([
      { id: 1, status: "confirmed", total: 583 },
    ]);
    expect(table.columns).toEqual(["id", "status", "total"]);
  });

  it("keeps every returned row", () => {
    // Rows are never dropped: a missing row changes the answer.
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    expect(buildResultTable(rows).rows).toHaveLength(100);
  });

  it("includes a column that only later rows have", () => {
    const table = buildResultTable([{ a: 1 }, { a: 2, b: 3 }]);
    expect(table.columns).toEqual(["a", "b"]);
    // The row without it gets an empty cell rather than a missing one.
    expect(table.rows[0]).toEqual(["1", ""]);
  });

  it("reports how many columns were dropped, if any", () => {
    const wide: Record<string, number> = {};
    for (let i = 0; i < MAX_TABLE_COLUMNS + 5; i++) wide[`c${i}`] = i;
    const table = buildResultTable([wide]);
    expect(table.columns).toHaveLength(MAX_TABLE_COLUMNS);
    expect(table.truncatedColumns).toBe(5);
  });

  it("gives a scalar result a table of its own", () => {
    // A single aggregate is still worth laying out.
    expect(buildResultTable([42]).columns).toEqual(["value"]);
    expect(buildResultTable([42]).rows).toEqual([["42"]]);
  });

  it("survives an empty result", () => {
    expect(buildResultTable([])).toEqual({
      columns: [],
      rows: [],
      truncatedColumns: 0,
    });
  });

  it("renders every cell as a string, so the table cannot receive an object", () => {
    const table = buildResultTable([{ payload: { nested: true }, id: null }]);
    for (const row of table.rows) {
      for (const cell of row) expect(typeof cell).toBe("string");
    }
  });
});
