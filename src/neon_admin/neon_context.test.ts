import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNeonClient } from "./neon_management_client";
import { getConnectionUri, getNeonTableSchema } from "./neon_context";
import {
  filterSchemaForTable,
  getSchema,
  renderSchemaSql,
  withDatabaseClient,
} from "ts-pg-schema-diff";

vi.mock("./neon_management_client", () => ({
  getNeonClient: vi.fn(),
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
    withDatabaseClient: vi.fn(),
  };
});

const getNeonClientMock = vi.mocked(getNeonClient);
const filterSchemaForTableMock = vi.mocked(filterSchemaForTable);
const getSchemaMock = vi.mocked(getSchema);
const renderSchemaSqlMock = vi.mocked(renderSchemaSql);
const withDatabaseClientMock = vi.mocked(withDatabaseClient);

describe("getConnectionUri", () => {
  beforeEach(() => {
    getNeonClientMock.mockReset();
    filterSchemaForTableMock.mockReset();
    getSchemaMock.mockReset();
    renderSchemaSqlMock.mockReset();
    withDatabaseClientMock.mockReset();
  });

  it("forwards the pooled option to Neon", async () => {
    const neonClient = {
      listProjectBranchRoles: vi.fn().mockResolvedValue({
        data: { roles: [{ name: "neondb_owner", protected: false }] },
      }),
      listProjectBranchDatabases: vi.fn().mockResolvedValue({
        data: { databases: [{ name: "neondb" }] },
      }),
      getConnectionUri: vi.fn().mockResolvedValue({
        data: { uri: "postgresql://test" },
      }),
    };
    getNeonClientMock.mockResolvedValue(
      neonClient as unknown as Awaited<ReturnType<typeof getNeonClient>>,
    );

    await expect(
      getConnectionUri({
        projectId: "project-id",
        branchId: "branch-id",
        pooled: false,
      }),
    ).resolves.toBe("postgresql://test");

    expect(neonClient.getConnectionUri).toHaveBeenCalledWith({
      projectId: "project-id",
      branch_id: "branch-id",
      database_name: "neondb",
      role_name: "neondb_owner",
      pooled: false,
    });
  });

  it("renders table schema as SQL through ts-pg-schema-diff", async () => {
    const neonClient = {
      listProjectBranchRoles: vi.fn().mockResolvedValue({
        data: { roles: [{ name: "neondb_owner", protected: false }] },
      }),
      listProjectBranchDatabases: vi.fn().mockResolvedValue({
        data: { databases: [{ name: "neondb" }] },
      }),
      getConnectionUri: vi.fn().mockResolvedValue({
        data: { uri: "postgresql://test" },
      }),
    };
    const schema = { tables: [{ name: "users" }] } as any;
    const filteredSchema = { tables: [{ name: "users-filtered" }] } as any;
    getNeonClientMock.mockResolvedValue(
      neonClient as unknown as Awaited<ReturnType<typeof getNeonClient>>,
    );
    withDatabaseClientMock.mockImplementation(
      async (_connectionUri, _options, callback) => callback({} as any),
    );
    getSchemaMock.mockResolvedValue(schema);
    filterSchemaForTableMock.mockReturnValue(filteredSchema);
    renderSchemaSqlMock.mockReturnValue(
      'CREATE TABLE "public"."users" ("id" bigint);',
    );

    await expect(
      getNeonTableSchema({
        projectId: "project-id",
        branchId: "branch-id",
        tableName: "users",
      }),
    ).resolves.toBe('CREATE TABLE "public"."users" ("id" bigint);');

    expect(withDatabaseClientMock).toHaveBeenCalledWith(
      "postgresql://test",
      expect.objectContaining({ ssl: true }),
      expect.any(Function),
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
