import { describe, it, expect } from "vitest";

// Import the helper from TableDetails
// Note: In a real scenario, you might want to move these helpers to a separate utils file
// For now, we'll define them here to match the implementation

/**
 * Format a cell value for display.
 * Handles null, undefined, objects, and long strings.
 */
function formatCellValue(value: unknown): string {
  if (value === null) {
    return "NULL";
  }
  if (value === undefined) {
    return "";
  }
  if (typeof value === "object") {
    try {
      const json = JSON.stringify(value);
      // Truncate long JSON
      return json.length > 100 ? json.slice(0, 100) + "..." : json;
    } catch {
      return "[Object]";
    }
  }
  const str = String(value);
  // Truncate long strings
  return str.length > 100 ? str.slice(0, 100) + "..." : str;
}

/**
 * Validate table name against allowed pattern.
 * Table names must start with a letter or underscore,
 * followed by alphanumeric characters or underscores.
 */
function isValidTableName(name: string): boolean {
  return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name);
}

/**
 * Calculate pagination info.
 */
function getPaginationInfo(
  total: number | null,
  limit: number,
  offset: number,
): {
  start: number;
  end: number;
  hasPrev: boolean;
  hasNext: boolean;
  currentPage: number;
  totalPages: number | null;
} {
  const start = offset + 1;
  const end = total !== null ? Math.min(offset + limit, total) : offset + limit;
  const hasPrev = offset > 0;
  const hasNext = total !== null ? offset + limit < total : false;
  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = total !== null ? Math.ceil(total / limit) : null;

  return { start, end, hasPrev, hasNext, currentPage, totalPages };
}

describe("formatCellValue", () => {
  it("returns 'NULL' for null values", () => {
    expect(formatCellValue(null)).toBe("NULL");
  });

  it("returns empty string for undefined values", () => {
    expect(formatCellValue(undefined)).toBe("");
  });

  it("returns string representation for primitives", () => {
    expect(formatCellValue(42)).toBe("42");
    expect(formatCellValue(true)).toBe("true");
    expect(formatCellValue("hello")).toBe("hello");
  });

  it("returns JSON for objects", () => {
    expect(formatCellValue({ a: 1 })).toBe('{"a":1}');
    expect(formatCellValue([1, 2, 3])).toBe("[1,2,3]");
  });

  it("truncates long strings", () => {
    const longString = "a".repeat(150);
    const result = formatCellValue(longString);
    expect(result.length).toBe(103); // 100 chars + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("truncates long JSON", () => {
    const longObject = { data: "x".repeat(150) };
    const result = formatCellValue(longObject);
    expect(result.length).toBe(103); // 100 chars + "..."
    expect(result.endsWith("...")).toBe(true);
  });

  it("handles circular references gracefully", () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatCellValue(circular)).toBe("[Object]");
  });

  it("handles Date objects", () => {
    const date = new Date("2024-01-15T12:00:00Z");
    const result = formatCellValue(date);
    expect(result).toContain("2024-01-15");
  });
});

describe("isValidTableName", () => {
  it("accepts valid table names", () => {
    expect(isValidTableName("users")).toBe(true);
    expect(isValidTableName("user_profiles")).toBe(true);
    expect(isValidTableName("_private_table")).toBe(true);
    expect(isValidTableName("Table1")).toBe(true);
    expect(isValidTableName("users_2024")).toBe(true);
  });

  it("rejects invalid table names", () => {
    expect(isValidTableName("")).toBe(false);
    expect(isValidTableName("123table")).toBe(false);
    expect(isValidTableName("user-profiles")).toBe(false);
    expect(isValidTableName("user.profiles")).toBe(false);
    expect(isValidTableName("user profiles")).toBe(false);
    expect(isValidTableName("DROP TABLE users;--")).toBe(false);
    expect(isValidTableName("users'; DROP TABLE users;--")).toBe(false);
  });
});

describe("getPaginationInfo", () => {
  it("calculates correct info for first page", () => {
    const info = getPaginationInfo(100, 25, 0);
    expect(info.start).toBe(1);
    expect(info.end).toBe(25);
    expect(info.hasPrev).toBe(false);
    expect(info.hasNext).toBe(true);
    expect(info.currentPage).toBe(1);
    expect(info.totalPages).toBe(4);
  });

  it("calculates correct info for middle page", () => {
    const info = getPaginationInfo(100, 25, 50);
    expect(info.start).toBe(51);
    expect(info.end).toBe(75);
    expect(info.hasPrev).toBe(true);
    expect(info.hasNext).toBe(true);
    expect(info.currentPage).toBe(3);
    expect(info.totalPages).toBe(4);
  });

  it("calculates correct info for last page", () => {
    const info = getPaginationInfo(100, 25, 75);
    expect(info.start).toBe(76);
    expect(info.end).toBe(100);
    expect(info.hasPrev).toBe(true);
    expect(info.hasNext).toBe(false);
    expect(info.currentPage).toBe(4);
    expect(info.totalPages).toBe(4);
  });

  it("handles partial last page", () => {
    const info = getPaginationInfo(90, 25, 75);
    expect(info.start).toBe(76);
    expect(info.end).toBe(90);
    expect(info.hasNext).toBe(false);
    expect(info.totalPages).toBe(4);
  });

  it("handles null total", () => {
    const info = getPaginationInfo(null, 25, 0);
    expect(info.start).toBe(1);
    expect(info.end).toBe(25);
    expect(info.hasPrev).toBe(false);
    expect(info.hasNext).toBe(false);
    expect(info.totalPages).toBe(null);
  });

  it("handles empty table", () => {
    const info = getPaginationInfo(0, 25, 0);
    expect(info.start).toBe(1);
    expect(info.end).toBe(0);
    expect(info.hasPrev).toBe(false);
    expect(info.hasNext).toBe(false);
    expect(info.totalPages).toBe(0);
  });
});
