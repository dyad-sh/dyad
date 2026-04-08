import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CommandExecutionError,
  SOCKET_FIREWALL_WARNING_MESSAGE,
} from "@/ipc/utils/socket_firewall";
import { ExecuteAddDependencyError } from "./executeAddDependency";

const { executeAddDependencyMock, readSettingsMock } = vi.hoisted(() => ({
  executeAddDependencyMock: vi.fn(),
  readSettingsMock: vi.fn(),
}));

const dbUpdates: Array<Record<string, unknown>> = [];

vi.mock("node:fs", async () => ({
  default: {
    existsSync: vi.fn().mockReturnValue(false),
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
  readSettings: readSettingsMock,
}));

vi.mock("./executeAddDependency", async () => {
  const actual = await vi.importActual<typeof import("./executeAddDependency")>(
    "./executeAddDependency",
  );

  return {
    ...actual,
    executeAddDependency: executeAddDependencyMock,
  };
});

import { db } from "../../db";
import { gitAdd } from "../utils/git_utils";
import { processFullResponseActions } from "./response_processor";

describe("processFullResponseActions add dependency errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbUpdates.length = 0;

    readSettingsMock.mockReturnValue({
      enableSupabaseWriteSqlMigration: false,
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
});
