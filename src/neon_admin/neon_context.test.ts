import { beforeEach, describe, expect, it, vi } from "vitest";
import { getNeonClient } from "./neon_management_client";
import {
  getConnectionUri,
  getNeonProjectInfo,
  getNeonTableSchema,
} from "./neon_context";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
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

  it("lists public and Better Auth tables with schema-qualified names", async () => {
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
      getProject: vi.fn().mockResolvedValue({
        data: { project: { name: "test-project" } },
      }),
      listProjectBranches: vi.fn().mockResolvedValue({
        data: { branches: [] },
      }),
    };
    getNeonClientMock.mockResolvedValue(
      neonClient as unknown as Awaited<ReturnType<typeof getNeonClient>>,
    );
    neonQueryMock.mockResolvedValue([
      { table_schema: "neon_auth", table_name: "user" },
      { table_schema: "public", table_name: "posts" },
    ]);

    const result = await getNeonProjectInfo({
      projectId: "project-id",
      branchId: "branch-id",
    });

    expect(neonQueryMock).toHaveBeenCalledWith(
      expect.stringMatching(/table_schema IN \('public', 'neon_auth'\)/u),
      [],
    );
    expect(result).toContain('["neon_auth.user","public.posts"]');
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
        /snapshot_scope\.table_schema_name IN \('public', 'neon_auth'\)[\s\S]*snapshot_scope\.table_name = 'users'[\s\S]*AS schema_snapshot/u,
      ),
      [],
    );
    expect(getSchemaFromSnapshotMock).toHaveBeenCalledWith({ tables: [] });
    expect(filterSchemaForTableMock).toHaveBeenCalledWith(schema, {
      schemaName: "public",
      tableName: "users",
    });
    expect(renderSchemaSqlMock).toHaveBeenCalledWith(
      filteredSchema,
      expect.objectContaining({
        emptySchemaComment:
          '-- No table named "users" found in public or neon_auth.',
      }),
    );
  });

  it("falls back to the Better Auth schema for a named table", async () => {
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
    const schema = { tables: [{ name: "user" }] } as any;
    const neonAuthSchema = { tables: [{ name: "neon-auth-user" }] } as any;
    getNeonClientMock.mockResolvedValue(
      neonClient as unknown as Awaited<ReturnType<typeof getNeonClient>>,
    );
    neonQueryMock.mockResolvedValue([{ schema_snapshot: { tables: [] } }]);
    getSchemaFromSnapshotMock.mockResolvedValue(schema);
    filterSchemaForTableMock
      .mockReturnValueOnce({ tables: [] } as any)
      .mockReturnValueOnce(neonAuthSchema);
    renderSchemaSqlMock.mockReturnValue(
      'CREATE TABLE "neon_auth"."user" ("id" text);',
    );

    await expect(
      getNeonTableSchema({
        projectId: "project-id",
        branchId: "branch-id",
        tableName: "user",
      }),
    ).resolves.toBe('CREATE TABLE "neon_auth"."user" ("id" text);');

    expect(filterSchemaForTableMock).toHaveBeenNthCalledWith(1, schema, {
      schemaName: "public",
      tableName: "user",
    });
    expect(filterSchemaForTableMock).toHaveBeenNthCalledWith(2, schema, {
      schemaName: "neon_auth",
      tableName: "user",
    });
    expect(renderSchemaSqlMock).toHaveBeenCalledWith(
      neonAuthSchema,
      expect.any(Object),
    );
  });

  it("returns the empty-table comment when app schemas have no tables", async () => {
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
    ).resolves.toBe("-- No tables found in public or neon_auth.");
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
      '-- No table named "missing CREATE ROLE admin" found in public or neon_auth.',
    );
  });

  it("preserves existing DyadError classifications", async () => {
    const authError = new DyadError(
      "Neon authentication failed",
      DyadErrorKind.Auth,
    );
    getNeonClientMock.mockRejectedValue(authError);

    await expect(
      getNeonTableSchema({
        projectId: "project-id",
        branchId: "branch-id",
      }),
    ).rejects.toBe(authError);
  });
});
