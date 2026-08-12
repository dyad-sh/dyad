import { describe, expect, it } from "vitest";

import {
  UnsupportedLiteralError,
  inlineParameters,
  toSqliteLiteral,
} from "@/lib/data_sources/sqlite_literal";

/**
 * This encoder only exists because browser sign-in routes queries through
 * wrangler, which takes no bind parameters. It is the one place in the query
 * path where a value becomes part of the statement, so the tests are about
 * what it refuses and what it cannot be tricked into.
 */
describe("SQLite literals", () => {
  it("doubles quotes rather than escaping them", () => {
    // SQLite has no backslash escape, so a doubled quote cannot be undone.
    expect(toSqliteLiteral("O'Brien")).toBe("'O''Brien'");
    expect(toSqliteLiteral("'; DROP TABLE users;--")).toBe(
      "'''; DROP TABLE users;--'",
    );
    expect(toSqliteLiteral("\\' OR 1=1 --")).toBe("'\\'' OR 1=1 --'");
  });

  it("encodes the types it understands", () => {
    expect(toSqliteLiteral(null)).toBe("NULL");
    expect(toSqliteLiteral(undefined)).toBe("NULL");
    expect(toSqliteLiteral(42)).toBe("42");
    expect(toSqliteLiteral(-1.5)).toBe("-1.5");
    expect(toSqliteLiteral(true)).toBe("1");
    expect(toSqliteLiteral(false)).toBe("0");
  });

  it("refuses what it cannot encode safely", () => {
    // A null byte truncates the value inside SQLite, so what is stored would
    // not be what was checked.
    expect(() => toSqliteLiteral("a\0b")).toThrow(UnsupportedLiteralError);
    expect(() => toSqliteLiteral(Number.NaN)).toThrow(UnsupportedLiteralError);
    expect(() => toSqliteLiteral(Infinity)).toThrow(UnsupportedLiteralError);
    expect(() => toSqliteLiteral({ a: 1 })).toThrow(UnsupportedLiteralError);
    expect(() => toSqliteLiteral([1, 2])).toThrow(UnsupportedLiteralError);
  });
});

describe("inlining parameters", () => {
  it("substitutes in order", () => {
    expect(
      inlineParameters("SELECT * FROM t WHERE a = ? AND b = ?", ["x", 2]),
    ).toBe("SELECT * FROM t WHERE a = 'x' AND b = 2");
  });

  it("leaves a question mark inside a string alone", () => {
    // The bug this guards: splitting on ? would treat this as a placeholder
    // and shift every later value by one position.
    expect(
      inlineParameters("SELECT * FROM t WHERE a = 'why?' AND b = ?", [7]),
    ).toBe("SELECT * FROM t WHERE a = 'why?' AND b = 7");
  });

  it("understands a doubled quote inside a string", () => {
    expect(
      inlineParameters("SELECT * FROM t WHERE a = 'O''Brien?' AND b = ?", [1]),
    ).toBe("SELECT * FROM t WHERE a = 'O''Brien?' AND b = 1");
  });

  it("refuses a mismatch rather than guessing", () => {
    expect(() => inlineParameters("a = ? AND b = ?", ["x"])).toThrow(
      UnsupportedLiteralError,
    );
    expect(() => inlineParameters("a = ?", ["x", "y"])).toThrow(
      UnsupportedLiteralError,
    );
  });

  it("cannot be escaped through an injected value", () => {
    const sql = inlineParameters("SELECT * FROM t WHERE name = ?", [
      "'; DROP TABLE t; SELECT '",
    ]);
    // The payload stays one string literal: its quotes are doubled, so the
    // statement never leaves the value.
    expect(sql).toBe(
      "SELECT * FROM t WHERE name = '''; DROP TABLE t; SELECT '''",
    );
  });
});
