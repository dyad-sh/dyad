import { describe, expect, it, vi } from "vitest";

vi.mock("../db", () => ({ db: {} }));
vi.mock("./supabase_provider", () => ({}));

import { buildDataSourceToolSet } from "@/ipc/utils/data_sources/data_source_tools";

/**
 * The tool surface itself, checked for the properties that make it safe.
 *
 * Execution needs a real project, so these cover the boundaries that hold
 * regardless of what a database returns.
 */
describe("buildDataSourceToolSet", () => {
  it("exposes nothing when the user selected nothing", () => {
    // An empty selection must mean no database tools at all, not tools that
    // quietly reach everything.
    expect(Object.keys(buildDataSourceToolSet([]))).toEqual([]);
  });

  it("exposes the read tools once a source is selected", () => {
    const names = Object.keys(buildDataSourceToolSet(["a"]));
    expect(names).toContain("list_data_sources");
    expect(names).toContain("search_schema");
    expect(names).toContain("get_relationships");
    expect(names).toContain("query_data_source");
    expect(names).toContain("mutate_data_source");
  });

  it("offers no raw or schema-changing database tool", () => {
    const names = Object.keys(buildDataSourceToolSet(["a"]));
    for (const forbidden of [
      "insert",
      "update",
      "delete",
      "drop",
      "truncate",
      "alter",
      "execute_sql",
      "raw_sql",
    ]) {
      expect(names.some((name) => name.includes(forbidden))).toBe(false);
    }
  });

  it("takes a structured plan rather than SQL", () => {
    const tools = buildDataSourceToolSet(["a"]);
    const shape = Object.keys(
      // @ts-expect-error zod shape access on the tool's input schema
      tools.query_data_source.inputSchema.shape,
    );
    expect(shape).toContain("table");
    expect(shape).toContain("filters");
    // There is deliberately no field a raw statement could arrive in.
    expect(shape).not.toContain("sql");
    expect(shape).not.toContain("query");
    expect(shape).not.toContain("statement");
  });

  it("takes a structured mutation rather than SQL", () => {
    const tools = buildDataSourceToolSet(["a"]);
    const shape = Object.keys(
      // @ts-expect-error zod shape access on the tool's input schema
      tools.mutate_data_source.inputSchema.shape,
    );
    expect(shape).toContain("action");
    expect(shape).toContain("table");
    expect(shape).toContain("values");
    expect(shape).toContain("filters");
    expect(shape).not.toContain("sql");
    expect(shape).not.toContain("statement");
  });

  it("caps how many rows one call may request", () => {
    const tools = buildDataSourceToolSet(["a"]);
    // @ts-expect-error zod shape access on the tool's input schema
    const limit = tools.query_data_source.inputSchema.shape.limit;
    expect(() => limit.parse(100_000)).toThrow();
    expect(limit.parse(50)).toBe(50);
  });

  it("describes itself in terms that discourage invention", () => {
    const tools = buildDataSourceToolSet(["a"]);
    const description = String(tools.query_data_source.description);
    expect(description.toLowerCase()).toContain("read-only");
    expect(description.toLowerCase()).toContain("never invent");
  });
});
