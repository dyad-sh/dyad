import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "./supabase_management_client";
import { getSupabaseTableSchema } from "./supabase_context";
import {
  filterSchemaForTable,
  getSchema,
  renderSchemaSql,
} from "ts-pg-schema-diff";

vi.mock("./supabase_management_client", () => ({
  getSupabaseClient: vi.fn(),
}));

vi.mock("ts-pg-schema-diff", async () => {
  const actual =
    await vi.importActual<typeof import("ts-pg-schema-diff")>(
      "ts-pg-schema-diff",
    );

  return {
    ...actual,
    filterSchemaForTable: vi.fn(),
    getSchema: vi.fn(),
    renderSchemaSql: vi.fn(),
  };
});

const getSupabaseClientMock = vi.mocked(getSupabaseClient);
const filterSchemaForTableMock = vi.mocked(filterSchemaForTable);
const getSchemaMock = vi.mocked(getSchema);
const renderSchemaSqlMock = vi.mocked(renderSchemaSql);

describe("getSupabaseTableSchema", () => {
  beforeEach(() => {
    getSupabaseClientMock.mockReset();
    filterSchemaForTableMock.mockReset();
    getSchemaMock.mockReset();
    renderSchemaSqlMock.mockReset();
  });

  it("renders table schema as SQL through a Supabase runQuery adapter", async () => {
    const runQuery = vi.fn().mockResolvedValue([{ ok: true }]);
    const schema = { tables: [{ name: "users" }] } as any;
    const filteredSchema = { tables: [{ name: "users-filtered" }] } as any;
    getSupabaseClientMock.mockResolvedValue({ runQuery } as any);
    getSchemaMock.mockImplementation(async (client) => {
      const result = await client.query(
        "SELECT $1::text AS value, $2::int AS number",
        ["O'Hare", 7],
      );
      expect(result.rows).toEqual([{ ok: true }]);
      return schema;
    });
    filterSchemaForTableMock.mockReturnValue(filteredSchema);
    renderSchemaSqlMock.mockReturnValue(
      'CREATE TABLE "public"."users" ("id" bigint);',
    );

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
        tableName: "users",
      }),
    ).resolves.toBe('CREATE TABLE "public"."users" ("id" bigint);');

    expect(runQuery).toHaveBeenCalledWith(
      "project-id",
      "SELECT 'O''Hare'::text AS value, 7::int AS number",
    );
    expect(getSchemaMock).toHaveBeenCalledWith(expect.anything(), {
      includeSchemas: ["public"],
    });
    expect(filterSchemaForTableMock).toHaveBeenCalledWith(schema, {
      tableName: "users",
    });
    expect(renderSchemaSqlMock).toHaveBeenCalledWith(
      filteredSchema,
      expect.objectContaining({
        emptySchemaComment: '-- No public table named "users" found.',
      }),
    );
  });
});
