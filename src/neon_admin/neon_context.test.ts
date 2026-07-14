import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNeonClient } from "./neon_management_client";
import { getConnectionUri, getNeonTableSchema } from "./neon_context";
import {
  filterSchemaForTable,
  getSchemaFromSnapshot,
  renderSchemaSql,
} from "ts-pg-schema-diff";

const { neonMock, neonQueryMock } = vi.hoisted(() => ({
  neonMock: vi.fn(),
  neonQueryMock: vi.fn(),
}));

vi.mock("@neondatabase/serverless", () => ({
  neon: neonMock.mockImplementation(() => ({ query: neonQueryMock })),
}));

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
    getSchemaFromSnapshot: vi.fn(),
    renderSchemaSql: vi.fn(),
  };
});

const getNeonClientMock = vi.mocked(getNeonClient);
const filterSchemaForTableMock = vi.mocked(filterSchemaForTable);
const getSchemaFromSnapshotMock = vi.mocked(getSchemaFromSnapshot);
const renderSchemaSqlMock = vi.mocked(renderSchemaSql);

describe("Neon context", () => {
  beforeEach(() => {
    getNeonClientMock.mockReset();
    neonMock.mockClear();
    neonQueryMock.mockReset();
    filterSchemaForTableMock.mockReset();
    getSchemaFromSnapshotMock.mockReset();
    renderSchemaSqlMock.mockReset();
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
    neonQueryMock.mockResolvedValue([{ schema_snapshot: { tables: [] } }]);
    getSchemaFromSnapshotMock.mockResolvedValue(schema);
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

    expect(neonMock).toHaveBeenCalledWith("postgresql://test");
    expect(neonQueryMock).toHaveBeenCalledTimes(1);
    expect(neonQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(
        /snapshot_scope\.table_schema_name IN \('public'\)[\s\S]*snapshot_scope\.table_name = 'users'[\s\S]*AS schema_snapshot/u,
      ),
      [],
    );
    expect(getSchemaFromSnapshotMock).toHaveBeenCalledWith({ tables: [] });
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

  it("returns the empty-table comment when public has no tables", async () => {
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
    neonQueryMock.mockResolvedValue([{ schema_snapshot: { tables: [] } }]);
    getSchemaFromSnapshotMock.mockResolvedValue({ tables: [] } as any);

    await expect(
      getNeonTableSchema({
        projectId: "project-id",
        branchId: "branch-id",
      }),
    ).resolves.toBe("-- No public tables found.");
    expect(renderSchemaSqlMock).not.toHaveBeenCalled();
  });

  it("keeps a missing table name on one SQL comment line", async () => {
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
    neonQueryMock.mockResolvedValue([{ schema_snapshot: { tables: [] } }]);
    getSchemaFromSnapshotMock.mockResolvedValue({
      tables: [{ name: "users" }],
    } as any);
    filterSchemaForTableMock.mockReturnValue({ tables: [] } as any);
    renderSchemaSqlMock.mockImplementation(
      (_schema, options) => options?.emptySchemaComment ?? "",
    );

    await expect(
      getNeonTableSchema({
        projectId: "project-id",
        branchId: "branch-id",
        tableName: "missing\nCREATE ROLE admin",
      }),
    ).resolves.toBe(
      '-- No public table named "missing CREATE ROLE admin" found.',
    );
  });
});
