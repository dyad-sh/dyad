import { describe, expect, it } from "vitest";
import { limitAgentSqlQuery, serializeSqlResult } from "./sql_result_limits";

const limits = {
  maxRows: 2,
  maxBytes: 512,
  maxCellBytes: 48,
};

describe("SQL result limits", () => {
  it("caps rows and reports truncation", () => {
    const result = serializeSqlResult(
      [{ id: 1 }, { id: 2 }, { id: 3 }],
      limits,
    );

    expect(JSON.parse(result.json)).toEqual([{ id: 1 }, { id: 2 }]);
    expect(result.text).toContain("2 of 3 rows");
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(512);
  });

  it("enforces UTF-8 byte caps without broken characters", () => {
    const result = serializeSqlResult([{ value: "😀".repeat(200) }], limits);

    expect(result.truncated).toBe(true);
    expect(result.text).not.toContain("�");
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(512);
    expect(() => JSON.parse(result.json)).not.toThrow();
  });

  it("keeps heavily escaped JSON within the byte budget", () => {
    const result = serializeSqlResult([{ value: "\0".repeat(2_000) }], limits);

    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text, "utf8")).toBeLessThanOrEqual(512);
    expect(() => JSON.parse(result.json)).not.toThrow();
  });

  it("preserves a result exactly at the row boundary", () => {
    const result = serializeSqlResult([{ id: 1 }, { id: 2 }], limits);

    expect(result.truncated).toBe(false);
    expect(result.notice).toBe("");
  });
});

describe("agent SQL query limiting", () => {
  it("wraps a single read SELECT with a sentinel row", () => {
    const result = limitAgentSqlQuery("SELECT * FROM users;", 100);

    expect(result.limited).toBe(true);
    expect(result.query).toContain("SELECT * FROM users");
    expect(result.query).toContain("LIMIT 101");
  });

  it.each([
    "CREATE TABLE users (id bigint);",
    "UPDATE users SET name = 'Ada';",
    "DELETE FROM users;",
    "SELECT 1; SELECT 2;",
    "DO $$ BEGIN DELETE FROM users; END $$;",
  ])("does not rewrite non-read or multi-statement SQL: %s", (query) => {
    expect(limitAgentSqlQuery(query, 100)).toEqual({
      query,
      limited: false,
    });
  });
});
