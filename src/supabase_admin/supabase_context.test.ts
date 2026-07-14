import { beforeEach, describe, expect, it, vi } from "vitest";
import { getSupabaseClient } from "./supabase_management_client";
import { getSupabaseTableSchema } from "./supabase_context";

vi.mock("./supabase_management_client", () => ({
  getSupabaseClient: vi.fn(),
}));

const getSupabaseClientMock = vi.mocked(getSupabaseClient);

const EMPTY_SNAPSHOT = {
  serverVersion: [{ server_version_num: "150000" }],
  schemas: [{ schema_name: "public" }],
  extensions: [],
  enums: [],
  tables: [],
  columns: [],
  checkConstraints: [],
  policies: [],
  tablePrivileges: [],
  indexes: [],
  foreignKeyConstraints: [],
  sequences: [],
  functions: [],
  procedures: [],
  functionDependencies: [],
  triggers: [],
  views: [],
  materializedViews: [],
};

describe("getSupabaseTableSchema", () => {
  beforeEach(() => {
    getSupabaseClientMock.mockReset();
  });

  it("renders table schema from one Supabase schema snapshot query", async () => {
    const runQuery = vi.fn().mockResolvedValue([
      {
        schema_snapshot: {
          ...EMPTY_SNAPSHOT,
          tables: [
            {
              oid: "123",
              table_name: "users",
              table_schema_name: "public",
              replica_identity: "d",
              rls_enabled: false,
              rls_forced: false,
              parent_table_name: "",
              parent_table_schema_name: "",
              partition_key_def: "",
              partition_for_values: "",
            },
          ],
          columns: [
            {
              table_oid: "123",
              column_name: "id",
              is_not_null: true,
              has_missing_val_optimization: false,
              column_size: 8,
              identity_type: "",
              start_value: null,
              increment_value: null,
              max_value: null,
              min_value: null,
              cache_size: null,
              is_cycle: null,
              collation_name: "",
              collation_schema_name: "",
              default_value: "",
              generation_expression: "",
              is_generated: false,
              column_type: "bigint",
            },
          ],
        },
      },
    ]);
    getSupabaseClientMock.mockResolvedValue({ runQuery } as any);

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
        tableName: "users",
      }),
    ).resolves.toBe(
      'CREATE SCHEMA "public";\n\nCREATE TABLE "public"."users" (\n\t"id" bigint NOT NULL\n);',
    );

    expect(runQuery).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledWith(
      "project-id",
      expect.stringMatching(
        /snapshot_scope\.table_schema_name IN \('public'\)[\s\S]*snapshot_scope\.table_name = 'users'[\s\S]*AS schema_snapshot/u,
      ),
    );
  });

  it("returns the empty-table comment when public has no tables", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValue([{ schema_snapshot: EMPTY_SNAPSHOT }]);
    getSupabaseClientMock.mockResolvedValue({ runQuery } as any);

    await expect(
      getSupabaseTableSchema({
        supabaseProjectId: "project-id",
        organizationSlug: null,
      }),
    ).resolves.toBe("-- No public tables found.");
  });
});
