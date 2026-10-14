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
  gitGetMergeConflicts: vi.fn(),
  isGitMergeInProgress: vi.fn(),
  isGitRebaseInProgress: vi.fn(),
  gitListBranches: vi.fn(),
  gitListRemoteBranches: vi.fn(),
  gitSetRemoteUrl: vi.fn(),
  isGitStatusClean: vi.fn(),
}));

import {
  ensureCleanWorkspace,
  handleConnectToExistingRepo,
  handleCreateRepo,
  handleGetGitState,
  handleGetMergeConflicts,
  normalizeGitHubRepoName,
  prepareLocalBranch,
} from "@/ipc/handlers/github_handlers";
import { createAppOperationHandler } from "@/ipc/utils/app_mutation_lock";
import { db } from "@/db";
import {
  gitCheckout,
  gitGetMergeConflicts,
  gitListBranches,
  isGitRebaseInProgress,
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
    const lockedConnectHandler = createAppOperationHandler(
      "test-connect",
      ["repository"],
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

describe("linking an app to GitHub", () => {
  const gitlabLinkedApp = {
    id: 1,
    path: "test-app",
    gitlabInstanceUrl: "https://gitlab.example.com",
    gitlabProjectId: 9,
    gitlabProjectPath: "team/app",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(db.query.apps.findFirst).mockResolvedValue(
      gitlabLinkedApp as never,
    );
  });

  // The one-provider invariant used to be enforced on the GitLab link paths
  // only. An app that ended up with both column sets resolves to GitHub,
  // because the resolver checks GitHub first — so the GitLab project was
  // orphaned with no error, no banner and nothing for the user to act on.
  it("refuses to create a repo for an app already linked to GitLab", async () => {
    await expect(
      handleCreateRepo({} as never, {
        org: "acme",
        repo: "demo",
        appId: 1,
      }),
    ).rejects.toThrow(/already linked to GitLab/);
  });

  it("refuses to link an existing repo to an app already on GitLab", async () => {
    await expect(
      handleConnectToExistingRepo({} as never, {
        owner: "acme",
        repo: "demo",
        branch: "main",
        appId: 1,
      }),
    ).rejects.toThrow(/already linked to GitLab/);
  });
});

describe("probing git for the sync state machine", () => {
  // A rebase found in progress was started by no operation the machine knows
  // about, so the probes are where its provider comes from.
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(isGitRebaseInProgress).mockReturnValue(true);
    vi.mocked(gitGetMergeConflicts).mockResolvedValue(["src/conflicted.ts"]);
  });

  it("reports GitLab for an app linked to a GitLab project", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue({
      id: 1,
      path: "test-app",
      gitlabInstanceUrl: "https://gitlab.example.com",
      gitlabProjectId: 9,
      gitlabProjectPath: "team/app",
    } as never);

    await expect(
      handleGetGitState({} as never, { appId: 1 }),
    ).resolves.toMatchObject({ rebaseInProgress: true, provider: "gitlab" });
    await expect(
      handleGetMergeConflicts({} as never, { appId: 1 }),
    ).resolves.toEqual({ files: ["src/conflicted.ts"], provider: "gitlab" });
  });

  it("reports GitHub for an app linked to a GitHub repo", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue({
      id: 1,
      path: "test-app",
      githubOrg: "acme",
      githubRepo: "demo",
    } as never);

    await expect(
      handleGetGitState({} as never, { appId: 1 }),
    ).resolves.toMatchObject({ provider: "github" });
  });

  it("reports no provider for an app with no linked remote", async () => {
    vi.mocked(db.query.apps.findFirst).mockResolvedValue({
      id: 1,
      path: "test-app",
    } as never);

    await expect(
      handleGetMergeConflicts({} as never, { appId: 1 }),
    ).resolves.toEqual({ files: ["src/conflicted.ts"], provider: null });
  });
});
