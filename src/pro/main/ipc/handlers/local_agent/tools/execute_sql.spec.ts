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
    ).toEqual({ sqlMutatesSchema: true, sqlDeletesData: false });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "SELECT * FROM users;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: false });
  });

  it("marks data-deleting SQL in consent metadata", () => {
    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "DELETE FROM users WHERE id = 1;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "UPDATE users SET email = NULL;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "DROP TABLE users;",
      }),
    ).toEqual({ sqlMutatesSchema: true, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query:
          "MERGE INTO users USING incoming ON users.id = incoming.id WHEN MATCHED THEN DELETE;",
      }),
    ).toEqual({ sqlMutatesSchema: false, sqlDeletesData: true });

    expect(
      executeSqlTool.getConsentMetadata?.({
        query: "DO $$ BEGIN DELETE FROM users; END $$;",
      }),
    ).toEqual({ sqlMutatesSchema: true, sqlDeletesData: true });
  });

  it("returns the full query as the consent preview", () => {
    const query = "a".repeat(5000);
    expect(executeSqlTool.getConsentPreview?.({ query })).toBe(query);
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
    const result = await executeSqlTool.execute(
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
    expect(result).toBe("Successfully executed SQL query.\n\nSQL result:\n[]");
    expect(
      executeSqlTool.shouldTrackMutation?.(
        { query: "SELECT * FROM users;" },
        result,
        {} as any,
      ),
    ).toBe(false);
  });
});
