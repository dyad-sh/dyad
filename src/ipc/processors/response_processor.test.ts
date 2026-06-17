import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandExecutionError,
  SOCKET_FIREWALL_WARNING_MESSAGE,
} from "@/ipc/utils/socket_firewall";
import { ExecuteAddDependencyError } from "./executeAddDependency";

const mocks = vi.hoisted(() => ({
  executeAddDependencyMock: vi.fn(),
  queueCloudSandboxSnapshotSyncMock: vi.fn(),
  readSettingsMock: vi.fn(),
  executeSupabaseSqlMock: vi.fn(),
  writeMigrationFileMock: vi.fn(),
  deployAllSupabaseFunctionsMock: vi.fn(),
  deploySupabaseFunctionsMock: vi.fn(),
  getSupabaseFunctionsAffectedBySharedModulesMock: vi.fn(),
}));

const {
  executeAddDependencyMock,
  queueCloudSandboxSnapshotSyncMock,
  readSettingsMock,
  executeSupabaseSqlMock,
  writeMigrationFileMock,
  deployAllSupabaseFunctionsMock,
  deploySupabaseFunctionsMock,
  getSupabaseFunctionsAffectedBySharedModulesMock,
} = mocks;

const dbUpdates: Array<Record<string, unknown>> = [];

vi.mock("node:fs", async () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    promises: {
      readFile: vi.fn().mockResolvedValue(""),
    },
  },
}));

vi.mock("../../db", () => ({
  db: {
    query: {
      chats: {
        findFirst: vi.fn(),
      },
      messages: {
        findFirst: vi.fn(),
      },
    },
    update: vi.fn(() => ({
      set: vi.fn((data: Record<string, unknown>) => {
        dbUpdates.push(data);
        return {
          where: vi.fn().mockResolvedValue(undefined),
        };
      }),
    })),
  },
}));

vi.mock("../../paths/paths", () => ({
  getDyadAppPath: vi.fn((appPath: string) => `/mock/apps/${appPath}`),
}));

vi.mock("../utils/git_utils", () => ({
  gitAdd: vi.fn(),
  gitCommit: vi.fn(),
  gitRemove: vi.fn(),
  gitAddAll: vi.fn(),
  getGitUncommittedFiles: vi.fn().mockResolvedValue([]),
  hasStagedChanges: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/main/settings", () => ({
  readSettings: mocks.readSettingsMock,
}));

vi.mock("../utils/cloud_sandbox_provider", () => ({
  queueCloudSandboxSnapshotSync: mocks.queueCloudSandboxSnapshotSyncMock,
}));

vi.mock("../../supabase_admin/supabase_management_client", () => ({
  executeSupabaseSql: mocks.executeSupabaseSqlMock,
  deleteSupabaseFunction: vi.fn(),
  deploySupabaseFunction: vi.fn(),
}));

vi.mock("../../supabase_admin/supabase_utils", async () => {
  const actual = await vi.importActual<
    typeof import("../../supabase_admin/supabase_utils")
  >("../../supabase_admin/supabase_utils");

  return {
    ...actual,
    deployAllSupabaseFunctions: mocks.deployAllSupabaseFunctionsMock,
    deploySupabaseFunctions: mocks.deploySupabaseFunctionsMock,
    getSupabaseFunctionsAffectedBySharedModules:
      mocks.getSupabaseFunctionsAffectedBySharedModulesMock,
  };
});

vi.mock("../utils/file_utils", () => ({
  writeMigrationFile: mocks.writeMigrationFileMock,
}));

vi.mock("./executeAddDependency", async () => {
  const actual = await vi.importActual<typeof import("./executeAddDependency")>(
    "./executeAddDependency",
  );

  return {
    ...actual,
    executeAddDependency: mocks.executeAddDependencyMock,
  };
});

import { db } from "../../db";
import { gitAdd, hasStagedChanges } from "../utils/git_utils";
import { processFullResponseActions } from "./response_processor";

describe("processFullResponseActions add dependency errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbUpdates.length = 0;

    readSettingsMock.mockReturnValue({
      enableSupabaseWriteSqlMigration: false,
    });
    executeSupabaseSqlMock.mockResolvedValue([]);
    writeMigrationFileMock.mockResolvedValue(
      "supabase/migrations/0000_test.sql",
    );
    deployAllSupabaseFunctionsMock.mockResolvedValue([]);
    deploySupabaseFunctionsMock.mockResolvedValue([]);
    getSupabaseFunctionsAffectedBySharedModulesMock.mockResolvedValue({
      kind: "partial",
      functionNames: ["alpha"],
    });

    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      app: {
        id: 1,
        path: "test-app",
      },
    } as any);
    vi.mocked(db.query.messages.findFirst).mockResolvedValue({
      id: 1,
      content: '<dyad-add-dependency packages="react"></dyad-add-dependency>',
    } as any);
  });

  it("writes a Supabase migration file for schema-mutating SQL", async () => {
    readSettingsMock.mockReturnValue({
      enableSupabaseWriteSqlMigration: true,
    });
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      app: {
        id: 1,
        path: "test-app",
        supabaseProjectId: "supabase-project",
        supabaseOrganizationSlug: "org",
      },
    } as any);

    await processFullResponseActions(
      '<dyad-execute-sql description="create users">CREATE TABLE users (id bigint);</dyad-execute-sql>',
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(executeSupabaseSqlMock).toHaveBeenCalledWith({
      supabaseProjectId: "supabase-project",
      query: "CREATE TABLE users (id bigint);",
      organizationSlug: "org",
    });
    expect(writeMigrationFileMock).toHaveBeenCalledWith(
      "/mock/apps/test-app",
      "CREATE TABLE users (id bigint);",
      "create users",
    );
  });

  it("skips Supabase migration files for non-schema SQL", async () => {
    readSettingsMock.mockReturnValue({
      enableSupabaseWriteSqlMigration: true,
    });
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      app: {
        id: 1,
        path: "test-app",
        supabaseProjectId: "supabase-project",
        supabaseOrganizationSlug: null,
      },
    } as any);

    await processFullResponseActions(
      '<dyad-execute-sql description="lookup users">SELECT * FROM users;</dyad-execute-sql>',
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(executeSupabaseSqlMock).toHaveBeenCalledWith({
      supabaseProjectId: "supabase-project",
      query: "SELECT * FROM users;",
      organizationSlug: null,
    });
    expect(writeMigrationFileMock).not.toHaveBeenCalled();
  });

  it("stores the relevant combined PTY verdict in the appended error card", async () => {
    executeAddDependencyMock.mockRejectedValue(
      new ExecuteAddDependencyError({
        error: new CommandExecutionError({
          message:
            "Command 'npx sfw@2.0.4 npm install --legacy-peer-deps react' exited with code 1",
          stdout:
            "Progress: resolved 12, reused 0, downloaded 0, added 0\nSocket Firewall blocked react<malware>\nPolicy: malware package",
          exitCode: 1,
        }),
        warningMessages: [],
      }),
    );

    await processFullResponseActions(
      '<dyad-add-dependency packages="react"></dyad-add-dependency>',
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    const contentUpdate = dbUpdates.find(
      (update) => typeof update.content === "string",
    );

    expect(contentUpdate?.content).toContain(
      'message="Failed to add dependencies: react. Socket Firewall blocked react&lt;malware&gt;"',
    );
    expect(contentUpdate?.content).toContain(
      "Socket Firewall blocked react&lt;malware&gt;\nPolicy: malware package",
    );
    expect(contentUpdate?.content).not.toContain(
      "Progress: resolved 12, reused 0, downloaded 0, added 0",
    );
  });

  it("preserves warning messages when a later processing step throws", async () => {
    executeAddDependencyMock.mockResolvedValue({
      installResults: "installed",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
    vi.mocked(gitAdd).mockRejectedValueOnce(new Error("git add failed"));

    const result = await processFullResponseActions(
      '<dyad-add-dependency packages="react"></dyad-add-dependency>',
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(result).toMatchObject({
      error: "Error: git add failed",
      warningMessages: [SOCKET_FIREWALL_WARNING_MESSAGE],
    });
  });

  it("queues delete tags for cloud sync even when the local path is already missing", async () => {
    vi.mocked(hasStagedChanges).mockResolvedValueOnce(true);

    const result = await processFullResponseActions(
      `
      <dyad-write path="src/file1.js">console.log("Hello");</dyad-write>
      <dyad-delete path="src/missing.js"></dyad-delete>
      `,
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(result).toMatchObject({
      updatedFiles: true,
    });
    expect(queueCloudSandboxSnapshotSyncMock).toHaveBeenCalledWith({
      appId: 1,
      changedPaths: ["src/file1.js"],
      deletedPaths: ["src/missing.js"],
    });
  });

  it("deploys shared-affected and skipped direct Supabase functions", async () => {
    vi.mocked(hasStagedChanges).mockResolvedValueOnce(true);
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      app: {
        id: 1,
        path: "test-app",
        supabaseProjectId: "supabase-project",
        supabaseOrganizationSlug: null,
      },
    } as any);

    const result = await processFullResponseActions(
      `
      <dyad-write path="supabase/functions/_shared/foo.ts">export const foo = 1;</dyad-write>
      <dyad-write path="supabase/functions/beta/index.ts">Deno.serve(() => new Response("ok"));</dyad-write>
      `,
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(result).toMatchObject({ updatedFiles: true });
    expect(
      getSupabaseFunctionsAffectedBySharedModulesMock,
    ).toHaveBeenCalledWith({
      appPath: "/mock/apps/test-app",
      changedSharedModulePaths: ["supabase/functions/_shared/foo.ts"],
    });
    expect(deploySupabaseFunctionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionNames: ["alpha", "beta"],
      }),
    );
    expect(deployAllSupabaseFunctionsMock).not.toHaveBeenCalled();
  });

  it("falls back to all Supabase functions for ambiguous shared dependency analysis", async () => {
    vi.mocked(hasStagedChanges).mockResolvedValueOnce(true);
    getSupabaseFunctionsAffectedBySharedModulesMock.mockResolvedValueOnce({
      kind: "all",
      reason: "typescript_not_installed",
    });
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      app: {
        id: 1,
        path: "test-app",
        supabaseProjectId: "supabase-project",
        supabaseOrganizationSlug: "org",
      },
    } as any);

    await processFullResponseActions(
      '<dyad-write path="supabase/functions/_shared/foo.ts">export const foo = 1;</dyad-write>',
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(deployAllSupabaseFunctionsMock).toHaveBeenCalledWith({
      appPath: "/mock/apps/test-app",
      supabaseProjectId: "supabase-project",
      supabaseOrganizationSlug: "org",
      skipPruneEdgeFunctions: false,
    });
    expect(deploySupabaseFunctionsMock).not.toHaveBeenCalled();
  });

  it("calls partial deploy helper for empty shared impact so pruning can still run", async () => {
    vi.mocked(hasStagedChanges).mockResolvedValueOnce(true);
    getSupabaseFunctionsAffectedBySharedModulesMock.mockResolvedValueOnce({
      kind: "partial",
      functionNames: [],
    });
    vi.mocked(db.query.chats.findFirst).mockResolvedValue({
      id: 1,
      appId: 1,
      app: {
        id: 1,
        path: "test-app",
        supabaseProjectId: "supabase-project",
        supabaseOrganizationSlug: null,
      },
    } as any);

    await processFullResponseActions(
      '<dyad-write path="supabase/functions/_shared/unused.ts">export const unused = 1;</dyad-write>',
      1,
      {
        chatSummary: undefined,
        messageId: 1,
      },
    );

    expect(deploySupabaseFunctionsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        functionNames: [],
      }),
    );
    expect(deployAllSupabaseFunctionsMock).not.toHaveBeenCalled();
  });
});
