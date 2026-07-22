import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/db", () => ({
  db: {
    query: { apps: { findFirst: vi.fn() } },
  },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((appPath: string) => `/mock/apps/${appPath}`),
  isAppLocationAccessible: vi.fn(),
}));

vi.mock("@/ipc/utils/git_utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/ipc/utils/git_utils")>()),
  gitCheckout: vi.fn(),
  gitFetch: vi.fn(),
  gitListBranches: vi.fn(),
  gitListRemoteBranches: vi.fn(),
  gitSetRemoteUrl: vi.fn(),
  isGitStatusClean: vi.fn(),
}));

import {
  ensureCleanWorkspace,
  normalizeGitHubRepoName,
  prepareLocalBranch,
} from "@/ipc/handlers/github_handlers";
import { createAppMutationLock } from "@/ipc/utils/app_mutation_lock";
import { db } from "@/db";
import {
  gitCheckout,
  gitListBranches,
  isGitStatusClean,
} from "@/ipc/utils/git_utils";

describe("normalizeGitHubRepoName", () => {
  it("should replace single space with hyphen", () => {
    expect(normalizeGitHubRepoName("my app")).toBe("my-app");
  });

  it("should replace multiple spaces with hyphens", () => {
    expect(normalizeGitHubRepoName("my cool app")).toBe("my-cool-app");
  });

  it("should replace consecutive spaces with a single hyphen", () => {
    expect(normalizeGitHubRepoName("my  app")).toBe("my-app");
  });

  it("should not modify names that are already kebab-case", () => {
    expect(normalizeGitHubRepoName("my-app")).toBe("my-app");
  });

  it("should fall back to 'untitled' for an empty string", () => {
    expect(normalizeGitHubRepoName("")).toBe("untitled");
  });

  it("should handle leading and trailing spaces", () => {
    expect(normalizeGitHubRepoName(" my app ")).toBe("my-app");
  });

  it("should handle tabs as whitespace", () => {
    expect(normalizeGitHubRepoName("my\tapp")).toBe("my-app");
  });

  it("should lowercase capitalized names", () => {
    expect(normalizeGitHubRepoName("My App")).toBe("my-app");
  });

  it("should split camelCase boundaries before lowercasing", () => {
    expect(normalizeGitHubRepoName("TaskMaster Pro")).toBe("task-master-pro");
  });

  it("should split acronym boundaries", () => {
    expect(normalizeGitHubRepoName("APIClient")).toBe("api-client");
  });
});

describe("prepareLocalBranch locking", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.apps.findFirst).mockResolvedValue({
      id: 1,
      path: "test-app",
    } as never);
    vi.mocked(isGitStatusClean).mockResolvedValue(true);
    vi.mocked(gitListBranches).mockResolvedValue(["main"]);
    vi.mocked(gitCheckout).mockResolvedValue(undefined);
  });

  it("completes when called by a whole-operation locked handler", async () => {
    const lockedConnectHandler = createAppMutationLock(
      async (_event: unknown, input: { appId: number }) => {
        await prepareLocalBranch(input);
      },
    );

    await expect(
      lockedConnectHandler({}, { appId: 1 }),
    ).resolves.toBeUndefined();
    expect(gitCheckout).toHaveBeenCalledWith({
      path: "/mock/apps/test-app",
      ref: "main",
    });
  });

  it("throws the structured uncommitted-changes code", async () => {
    vi.mocked(isGitStatusClean).mockResolvedValue(false);

    await expect(
      ensureCleanWorkspace("/mock/apps/test-app", "switching branches"),
    ).rejects.toMatchObject({
      name: "GitStateError",
      code: "UNCOMMITTED_CHANGES",
    });
  });
});
