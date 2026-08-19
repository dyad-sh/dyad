import { describe, expect, it } from "vitest";

import {
  d1MutationSqlFromPlan,
  d1SqlFromPlan,
} from "@/ipc/utils/data_sources/cloudflare_d1_provider";
import { d1Endpoint, isD1Endpoint } from "@/lib/data_sources/d1_endpoint";

/**
 * This is the boundary between what a model asked for and what runs against
 * the user's database, so the tests are about what it refuses and what it
 * never interpolates.
 */
describe("D1 SQL generation", () => {
  it("selects the requested columns with a bounded limit", () => {
    const { sql, params } = d1SqlFromPlan({
      table: "customers",
      select: ["id", "name"],
      limit: 25,
    });
    expect(sql).toBe("SELECT id, name FROM customers LIMIT 25");
    expect(params).toEqual([]);
  });

  it("never puts a value into the statement", () => {
    // A value that looks like SQL must arrive as data, not syntax.
    const { sql, params } = d1SqlFromPlan({
      table: "customers",
      filters: [
        { column: "city", operator: "=", value: "'; DROP TABLE customers;--" },
      ],
      limit: 10,
    });
    expect(sql).toBe("SELECT * FROM customers WHERE city = ? LIMIT 10");
    expect(params).toEqual(["'; DROP TABLE customers;--"]);
    expect(sql).not.toContain("DROP");
  });

  it("refuses an identifier that is not a plain name", () => {
    // Identifiers cannot be parameterised, so the only safe answer is no.
    for (const table of ["customers; DROP TABLE x", "custo mers", '"users"']) {
      expect(() => d1SqlFromPlan({ table, limit: 10 })).toThrow(
        /Unsupported identifier/,
      );
    }
    expect(() =>
      d1SqlFromPlan({
        table: "customers",
        select: ["id", "name; DROP TABLE x"],
        limit: 10,
      }),
    ).toThrow(/Unsupported identifier/);
  });

  it("expands IN to one placeholder per value", () => {
    const { sql, params } = d1SqlFromPlan({
      table: "orders",
      filters: [{ column: "status", operator: "in", value: ["paid", "sent"] }],
      limit: 10,
    });
    expect(sql).toBe("SELECT * FROM orders WHERE status IN (?, ?) LIMIT 10");
    expect(params).toEqual(["paid", "sent"]);
  });

  it("writes null checks without a parameter", () => {
    const { sql, params } = d1SqlFromPlan({
      table: "invoices",
      filters: [{ column: "paid_at", operator: "is_null" }],
      limit: 10,
    });
    expect(sql).toBe("SELECT * FROM invoices WHERE paid_at IS NULL LIMIT 10");
    expect(params).toEqual([]);
  });

  it("clamps the row limit at both ends", () => {
    expect(d1SqlFromPlan({ table: "t", limit: 100_000 }).sql).toContain(
      "LIMIT 1000",
    );
    expect(d1SqlFromPlan({ table: "t", limit: 0 }).sql).toContain("LIMIT 100");
  });

  it("orders only by a real identifier", () => {
    expect(
      d1SqlFromPlan({
        table: "t",
        orderBy: { column: "created_at", direction: "desc" },
        limit: 5,
      }).sql,
    ).toBe("SELECT * FROM t ORDER BY created_at DESC LIMIT 5");
    expect(() =>
      d1SqlFromPlan({
        table: "t",
        orderBy: { column: "1; DROP TABLE t", direction: "asc" },
        limit: 5,
      }),
    ).toThrow(/Unsupported identifier/);
  });
});

describe("D1 endpoints", () => {
  it("builds and recognises a database endpoint", () => {
    const endpoint = d1Endpoint("acct123", "db456");
    expect(endpoint).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acct123/d1/database/db456",
    );
    expect(isD1Endpoint(endpoint)).toBe(true);
  });

  it("rejects anything that is not one", () => {
    for (const value of [
      "https://example.com/query",
      "http://api.cloudflare.com/client/v4/accounts/a/d1/database/b",
      "https://api.cloudflare.com/client/v4/accounts/a/d1/database/b/query",
      "",
    ]) {
      expect(isD1Endpoint(value), value).toBe(false);
    }
  });
});

describe("D1 mutation SQL generation", () => {
  it("parameterises every inserted value", () => {
    const result = d1MutationSqlFromPlan({
      action: "insert",
      table: "investigations",
      values: { code_name: "GayBlade", status: "open" },
      filters: [],
    });
    expect(result.sql).toBe(
      "INSERT INTO investigations (code_name, status) VALUES (?, ?) RETURNING *",
    );
    expect(result.params).toEqual(["GayBlade", "open"]);
  });

  it("parameterises update fields and its target key", () => {
    const result = d1MutationSqlFromPlan({
      action: "update",
      table: "investigations",
      values: { status: "closed" },
      filters: [{ column: "id", operator: "=", value: "case-1" }],
    });
    expect(result.sql).toBe(
      "UPDATE investigations SET status = ? WHERE id = ? RETURNING *",
    );
    expect(result.params).toEqual(["closed", "case-1"]);
  });

  it("never interpolates a delete filter value", () => {
    const result = d1MutationSqlFromPlan({
      action: "delete",
      table: "investigations",
      values: {},
      filters: [
        { column: "id", operator: "=", value: "x'; DROP TABLE users;--" },
      ],
    });
    expect(result.sql).toBe(
      "DELETE FROM investigations WHERE id = ? RETURNING *",
    );
    expect(result.sql).not.toContain("DROP");
    expect(result.params).toEqual(["x'; DROP TABLE users;--"]);
  });
});
