import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentContext } from "./types";
import { executeSqlTool } from "./execute_sql";
import { getDatabaseTableSchemaTool } from "./get_database_table_schema";

const {
  executeSupabaseSqlMock,
  executeNeonSqlMock,
  getSupabaseTableSchemaMock,
  getNeonTableSchemaMock,
} = vi.hoisted(() => ({
  executeSupabaseSqlMock: vi.fn(),
  executeNeonSqlMock: vi.fn(),
  getSupabaseTableSchemaMock: vi.fn(),
  getNeonTableSchemaMock: vi.fn(),
}));

vi.mock("../../../../../../supabase_admin/supabase_management_client", () => ({
  executeSupabaseSql: executeSupabaseSqlMock,
}));
vi.mock("../../../../../../neon_admin/neon_context", () => ({
  executeNeonSql: executeNeonSqlMock,
  getNeonTableSchema: getNeonTableSchemaMock,
}));
vi.mock("../../../../../../supabase_admin/supabase_context", () => ({
  getSupabaseTableSchema: getSupabaseTableSchemaMock,
}));
vi.mock("../../../../../../main/settings", () => ({
  readSettings: () => ({ enableSupabaseWriteSqlMigration: false }),
}));
vi.mock("../../../../../../ipc/utils/file_utils", () => ({
  writeMigrationFile: vi.fn(),
}));

function supabaseContext(): AgentContext {
  return {
    appPath: "/tmp/app",
    supabaseProjectId: "supabase-project",
    supabaseOrganizationSlug: "supabase-org",
    supabaseProviderToolsAvailable: true,
    neonProjectId: null,
    neonActiveBranchId: null,
    neonProviderToolsAvailable: false,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext;
}

function neonContext(): AgentContext {
  return {
    appPath: "/tmp/app",
    supabaseProjectId: null,
    supabaseOrganizationSlug: null,
    supabaseProviderToolsAvailable: false,
    neonProjectId: "neon-project",
    neonActiveBranchId: "neon-branch",
    neonProviderToolsAvailable: true,
    onXmlStream: vi.fn(),
    onXmlComplete: vi.fn(),
  } as unknown as AgentContext;
}

describe("database provider tool routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    executeSupabaseSqlMock.mockResolvedValue("supabase result");
    executeNeonSqlMock.mockResolvedValue("neon result");
    getSupabaseTableSchemaMock.mockResolvedValue("supabase schema");
    getNeonTableSchemaMock.mockResolvedValue("neon schema");
  });

  it("routes SQL to an available Supabase provider", async () => {
    await executeSqlTool.execute({ query: "select 1" }, supabaseContext());

    expect(executeSupabaseSqlMock).toHaveBeenCalled();
    expect(executeNeonSqlMock).not.toHaveBeenCalled();
  });

  it("routes schema reads to an available Supabase provider", async () => {
    await getDatabaseTableSchemaTool.execute({}, supabaseContext());

    expect(getSupabaseTableSchemaMock).toHaveBeenCalled();
    expect(getNeonTableSchemaMock).not.toHaveBeenCalled();
  });

  it("routes SQL to an available Neon provider", async () => {
    await executeSqlTool.execute({ query: "select 1" }, neonContext());

    expect(executeNeonSqlMock).toHaveBeenCalled();
    expect(executeSupabaseSqlMock).not.toHaveBeenCalled();
  });

  it("routes schema reads to an available Neon provider", async () => {
    await getDatabaseTableSchemaTool.execute({}, neonContext());

    expect(getNeonTableSchemaMock).toHaveBeenCalled();
    expect(getSupabaseTableSchemaMock).not.toHaveBeenCalled();
  });
});
