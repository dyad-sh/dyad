import { beforeEach, describe, expect, it, vi } from "vitest";
import { executeSqlTool } from "./execute_sql";

const mocks = vi.hoisted(() => ({
  executeSupabaseSqlMock: vi.fn(),
  executeNeonSqlMock: vi.fn(),
  writeMigrationFileMock: vi.fn(),
  readSettingsMock: vi.fn(),
}));

vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  executeSupabaseSql: mocks.executeSupabaseSqlMock,
}));

vi.mock("../../../../../../neon_admin/neon_context", () => ({
  executeNeonSql: mocks.executeNeonSqlMock,
}));

vi.mock("../../../../../../ipc/utils/file_utils", () => ({
  writeMigrationFile: mocks.writeMigrationFileMock,
}));

vi.mock("../../../../../../main/settings", () => ({
  readSettings: mocks.readSettingsMock,
}));

describe("executeSqlTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeSupabaseSqlMock.mockResolvedValue("[]");
    mocks.writeMigrationFileMock.mockResolvedValue(
      "supabase/migrations/0000_test.sql",
    );
    mocks.readSettingsMock.mockReturnValue({
      enableSupabaseWriteSqlMigration: true,
    });
  });

  it("marks mutating SQL in consent metadata", () => {
    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "CREATE TABLE users (id bigint);",
      }),
    ).toEqual({ sqlMutatesSchema: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "SELECT * FROM users;",
      }),
    ).toEqual({ sqlMutatesSchema: false });
  });

  it("writes a Supabase migration file for schema-mutating SQL", async () => {
    await executeSqlTool.execute(
      {
        query: "CREATE TABLE users (id bigint);",
        description: "create users",
      },
      {
        appPath: "/app",
        supabaseProjectId: "project",
        supabaseOrganizationSlug: "org",
      } as any,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith({
      supabaseProjectId: "project",
      query: "CREATE TABLE users (id bigint);",
      organizationSlug: "org",
    });
    expect(mocks.writeMigrationFileMock).toHaveBeenCalledWith(
      "/app",
      "CREATE TABLE users (id bigint);",
      "create users",
    );
  });

  it("skips Supabase migration files for non-schema SQL", async () => {
    await executeSqlTool.execute(
      {
        query: "SELECT * FROM users;",
        description: "lookup users",
      },
      {
        appPath: "/app",
        supabaseProjectId: "project",
        supabaseOrganizationSlug: null,
      } as any,
    );

    expect(mocks.executeSupabaseSqlMock).toHaveBeenCalledWith({
      supabaseProjectId: "project",
      query: "SELECT * FROM users;",
      organizationSlug: null,
    });
    expect(mocks.writeMigrationFileMock).not.toHaveBeenCalled();
  });
});
