import { describe, it, expect, vi, beforeEach } from "vitest";
import fetch from "node-fetch";
import { readSettings } from "@/main/settings";

vi.mock("node-fetch", () => ({ default: vi.fn() }));
vi.mock("@/main/settings", () => ({
  readSettings: vi.fn(),
  writeSettings: vi.fn(),
}));

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
  execGit: vi.fn(),
}));

import {
  ensureCleanWorkspace,
  handleConnectToExistingRepo,
  handleCreateRepo,
  handleGetGitState,
  handleGetMergeConflicts,
  normalizeGitHubRepoName,
  prepareLocalBranch,
  verifyGithubConnection,
} from "@/ipc/handlers/github_handlers";
import { getGitHubApiBase } from "@/ipc/utils/github_endpoints";
import { createAppOperationHandler } from "@/ipc/utils/app_mutation_lock";
import { DyadErrorKind } from "@/errors/dyad_error";
import { db } from "@/db";
import {
  gitCheckout,
  gitFetch,
  gitGetMergeConflicts,
  gitListBranches,
  isGitRebaseInProgress,
  isGitStatusClean,
  execGit,
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

describe("verifyGithubConnection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(readSettings).mockReturnValue({
      githubAccessToken: { value: "test-token" },
    } as never);
    vi.mocked(db.query.apps.findFirst).mockResolvedValue({
      id: 1,
      path: "demo",
      githubOrg: "acme",
      githubRepo: "demo",
      githubBranch: "feature/deploy",
    } as never);
    vi.mocked(execGit).mockImplementation(
      async (args) =>
        ({
          exitCode: 0,
          stderr: "",
          stdout:
            args[0] === "remote"
              ? "https://github.com/acme/demo.git\n"
              : args[0] === "branch"
                ? "feature/deploy\n"
                : "local-sha\n",
        }) as never,
    );
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => ({ commit: { sha: "local-sha" } }),
    } as never);
    vi.mocked(isGitStatusClean).mockResolvedValue(true);
  });

  it("verifies the local remote and the exact remote branch with authenticated GitHub access", async () => {
    await expect(
      verifyGithubConnection({ appId: 1, requireSynced: true }),
    ).resolves.toEqual({
      owner: "acme",
      repo: "demo",
      branch: "feature/deploy",
    });
    expect(fetch).toHaveBeenCalledWith(
      `${getGitHubApiBase()}/repos/acme/demo/branches/feature%2Fdeploy`,
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("fetches with per-request authentication and accepts a fast-forward push with dirty files", async () => {
    vi.mocked(isGitStatusClean).mockResolvedValue(false);
    await expect(
      verifyGithubConnection({ appId: 1, requirePushable: true }),
    ).resolves.toEqual({
      owner: "acme",
      repo: "demo",
      branch: "feature/deploy",
    });
    expect(gitFetch).toHaveBeenCalledWith({
      path: "/mock/apps/demo",
      remote: "https://github.com/acme/demo.git",
      auth: expect.objectContaining({
        username: "test-token",
        password: "x-oauth-basic",
      }),
    });
    expect(execGit).toHaveBeenCalledWith(
      ["merge-base", "--is-ancestor", "--", "local-sha", "HEAD"],
      "/mock/apps/demo",
    );
  });

  it.each([1, 128])(
    "rejects remote history that is not a known ancestor (exit %i)",
    async (exitCode) => {
      const original = vi.mocked(execGit).getMockImplementation()!;
      vi.mocked(execGit).mockImplementation(async (args, cwd) =>
        args[0] === "merge-base"
          ? ({ exitCode, stdout: "", stderr: "" } as never)
          : original(args, cwd),
      );
      await expect(
        verifyGithubConnection({ appId: 1, requirePushable: true }),
      ).rejects.toMatchObject({
        kind: DyadErrorKind.Precondition,
        message: expect.stringContaining(
          "Sync with GitHub and resolve any conflicts",
        ),
      });
    },
  );

  it("rejects stale saved metadata when origin points elsewhere", async () => {
    vi.mocked(execGit).mockResolvedValueOnce({
      exitCode: 0,
      stdout: "https://github.com/other/repo.git",
      stderr: "",
    } as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toThrow(
      "local GitHub remote",
    );
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects a local branch that differs from the deployment branch", async () => {
    vi.mocked(execGit)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "https://github.com/acme/demo.git",
        stderr: "",
      } as never)
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "other",
        stderr: "",
      } as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toThrow(
      "connected GitHub branch",
    );
  });

  it("rejects missing credentials and repositories", async () => {
    vi.mocked(readSettings).mockReturnValueOnce({} as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toThrow(
      "Reconnect your GitHub",
    );
    vi.mocked(db.query.apps.findFirst).mockResolvedValueOnce({
      id: 1,
    } as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toThrow(
      "Create or connect",
    );
    vi.mocked(fetch).mockResolvedValueOnce({ ok: false } as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toThrow(
      "Could not verify",
    );
  });

  it("rejects incomplete pushes and uncommitted changes", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ commit: { sha: "old-sha" } }),
    } as never);
    await expect(
      verifyGithubConnection({ appId: 1, requireSynced: true }),
    ).rejects.toThrow("not in sync");
    vi.mocked(isGitStatusClean).mockResolvedValueOnce(false);
    await expect(
      verifyGithubConnection({ appId: 1, requireSynced: true }),
    ).rejects.toThrow("not in sync");
  });

  it.each([
    "git@github.com:acme/demo.git",
    "ssh://git@github.com/Acme/Demo.git",
    "ssh://git@github.com:22/acme/demo.git",
    "https://github.com:443/acme/demo.git",
    "https://github.com/acme/demo/",
  ])("accepts %s as the app's remote", async (remoteUrl) => {
    const succeed = vi.mocked(execGit).getMockImplementation()!;
    vi.mocked(execGit).mockImplementation(async (args, cwd) =>
      args[0] === "remote"
        ? ({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" } as never)
        : succeed(args, cwd),
    );
    await expect(
      verifyGithubConnection({ appId: 1, requirePushable: true }),
    ).resolves.toEqual({
      owner: "acme",
      repo: "demo",
      branch: "feature/deploy",
    });
    expect(gitFetch).toHaveBeenCalledWith({
      path: "/mock/apps/demo",
      remote: "https://github.com/acme/demo.git",
      auth: expect.objectContaining({ username: "test-token" }),
    });
  });

  it.each([
    "https://github.com:8443/acme/demo.git",
    "ssh://git@github.com:2222/acme/demo.git",
    "git+ssh://git@github.com:2222/acme/demo.git",
  ])("rejects a different server at %s", async (remote) => {
    vi.mocked(execGit).mockResolvedValueOnce({
      exitCode: 0,
      stdout: remote,
      stderr: "",
    } as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toMatchObject({
      kind: DyadErrorKind.Precondition,
      message: expect.stringContaining("remote does not match"),
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, DyadErrorKind.Auth, "Reconnect your GitHub account"],
    [404, DyadErrorKind.Precondition, "sync or push your code first"],
    [403, DyadErrorKind.External, "retry in a moment"],
    [429, DyadErrorKind.External, "retry in a moment"],
    [500, DyadErrorKind.External, "retry in a moment"],
  ])(
    "provides actionable guidance for GitHub HTTP %s",
    async (status, kind, message) => {
      vi.mocked(fetch).mockResolvedValueOnce({ ok: false, status } as never);
      await expect(verifyGithubConnection({ appId: 1 })).rejects.toMatchObject({
        kind,
        message: expect.stringContaining(message),
      });
    },
  );

  it.each(["headers", "body"])(
    "reports a timeout while reading %s",
    async (phase) => {
      const controller = new AbortController();
      const timeout = vi
        .spyOn(AbortSignal, "timeout")
        .mockReturnValueOnce(controller.signal);
      const abort = async () => {
        controller.abort();
        throw new Error("The operation was aborted");
      };
      if (phase === "headers") vi.mocked(fetch).mockImplementationOnce(abort);
      else
        vi.mocked(fetch).mockResolvedValueOnce({
          ok: true,
          json: abort,
        } as never);
      try {
        await expect(
          verifyGithubConnection({ appId: 1 }),
        ).rejects.toMatchObject({
          kind: DyadErrorKind.External,
          message: expect.stringContaining("timed out after 15 seconds"),
        });
        expect(timeout).toHaveBeenCalledWith(15_000);
      } finally {
        timeout.mockRestore();
      }
    },
  );

  it.each([
    ["remote", "local GitHub remote"],
    ["branch", "connected GitHub branch"],
    ["rev-parse", "not in sync"],
  ])("rejects when git %s fails", async (command, message) => {
    const succeed = vi.mocked(execGit).getMockImplementation()!;
    vi.mocked(execGit).mockImplementation(async (args, cwd) =>
      args[0] === command
        ? ({ ...(await succeed(args, cwd)), exitCode: 1 } as never)
        : succeed(args, cwd),
    );
    await expect(
      verifyGithubConnection({ appId: 1, requireSynced: true }),
    ).rejects.toThrow(message);
  });

  it("bounds the GitHub request and classifies network failures", async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError("fetch failed"));
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toMatchObject({
      name: "DyadError",
      kind: DyadErrorKind.External,
      message: expect.stringContaining("Could not reach GitHub"),
    });
    expect(fetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it.each([
    ["a branch without a commit", async () => ({ name: "feature/deploy" })],
    ["a non-object body", async () => null],
    [
      "an unreadable body",
      async () => {
        throw new SyntaxError("Unexpected token");
      },
    ],
  ])("rejects %s from GitHub", async (_, json) => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json } as never);
    await expect(verifyGithubConnection({ appId: 1 })).rejects.toMatchObject({
      kind: DyadErrorKind.External,
      message: expect.stringContaining("unexpected response"),
    });
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
