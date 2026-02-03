import { describe, it, expect } from "vitest";
import {
  formatCellValue,
  isValidTableName,
  getPaginationInfo,
} from "../lib/supabase_utils";

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
    // Date objects are serialized via JSON.stringify which returns ISO string in quotes
    expect(result).toBe('"2024-01-15T12:00:00.000Z"');
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
    // For empty tables, start should be 0 to avoid showing "1-0 of 0"
    expect(info.start).toBe(0);
    expect(info.end).toBe(0);
    expect(info.hasPrev).toBe(false);
    expect(info.hasNext).toBe(false);
    expect(info.totalPages).toBe(0);
  });
});
