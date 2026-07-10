import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_APP_SEARCH_RESULTS,
  MAX_APP_SEARCH_TEXT_BYTES,
  searchAppsWithResultLimits,
} from "./app_search_service";
import { messages } from "../../db/schema";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";

const mocks = vi.hoisted(() => ({
  select: vi.fn(),
}));

vi.mock("../../db", () => ({
  db: { select: mocks.select },
}));

function queryReturning(rows: unknown[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {};
  for (const method of ["from", "innerJoin", "where", "groupBy", "orderBy"]) {
    query[method] = vi.fn(() => query);
  }
  query.limit = vi.fn().mockResolvedValue(rows);
  return query;
}

function appResult(id: number, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: `App ${id}`,
    createdAt: new Date(2025, 0, id + 1),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("searchAppsWithResultLimits", () => {
  it("does not run broad one-character database searches", async () => {
    await expect(searchAppsWithResultLimits("a")).resolves.toEqual([]);
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("treats SQLite LIKE wildcard characters as literal search text", async () => {
    const builders = [
      queryReturning([]),
      queryReturning([]),
      queryReturning([]),
    ];
    const queries = [...builders];
    mocks.select.mockImplementation(() => queries.shift());

    await searchAppsWithResultLimits("100%_\\");

    const dialect = new SQLiteSyncDialect();
    for (const builder of builders) {
      const condition = builder.where.mock.calls[0][0];
      const compiled = dialect.sqlToQuery(condition);
      expect(compiled.sql).toContain("LIKE ? ESCAPE '\\'");
      expect(compiled.params).toEqual(["%100\\%\\_\\\\%"]);
    }
  });

  it("limits every source query and reports broad-result truncation", async () => {
    const nameRows = Array.from(
      { length: MAX_APP_SEARCH_RESULTS + 1 },
      (_, index) => appResult(index),
    );
    const builders = [
      queryReturning(nameRows),
      queryReturning([]),
      queryReturning([]),
    ];
    const queries = [...builders];
    mocks.select.mockImplementation(() => queries.shift());

    const results = await searchAppsWithResultLimits("app");

    expect(results).toHaveLength(MAX_APP_SEARCH_RESULTS);
    expect(results.every((result) => result.searchTruncated)).toBe(true);
    // Each query builder receives LIMIT + 1 so truncation can be detected.
    expect(mocks.select).toHaveBeenCalledTimes(3);
    for (const builder of builders) {
      expect(builder.limit).toHaveBeenCalledWith(MAX_APP_SEARCH_RESULTS + 1);
    }
    const messageProjection = mocks.select.mock.calls[2][0] as {
      matchedChatMessage: unknown;
    };
    expect(messageProjection.matchedChatMessage).not.toBe(messages.content);
  });

  it("bounds projected text again by UTF-8 bytes", async () => {
    const messageQuery = queryReturning([
      appResult(1, {
        matchedChatTitle: null,
        matchedChatMessage: "😀".repeat(2_000),
      }),
    ]);
    const queries = [queryReturning([]), queryReturning([]), messageQuery];
    mocks.select.mockImplementation(() => queries.shift());

    const [result] = await searchAppsWithResultLimits("emoji");

    expect(
      Buffer.byteLength(result.matchedChatMessage ?? "", "utf8"),
    ).toBeLessThanOrEqual(MAX_APP_SEARCH_TEXT_BYTES);
    expect(result.matchedChatMessage).not.toContain("�");
  });

  it("does not report truncation at the exact result boundary", async () => {
    const nameRows = Array.from(
      { length: MAX_APP_SEARCH_RESULTS },
      (_, index) => appResult(index),
    );
    const queries = [
      queryReturning(nameRows),
      queryReturning([]),
      queryReturning([]),
    ];
    mocks.select.mockImplementation(() => queries.shift());

    const results = await searchAppsWithResultLimits("app");

    expect(results).toHaveLength(MAX_APP_SEARCH_RESULTS);
    expect(results.some((result) => result.searchTruncated)).toBe(false);
  });
});
