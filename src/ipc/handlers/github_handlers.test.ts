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
  gitListBranches: vi.fn(),
  gitListRemoteBranches: vi.fn(),
  gitSetRemoteUrl: vi.fn(),
  isGitStatusClean: vi.fn(),
  execGit: vi.fn(),
}));

import {
  ensureCleanWorkspace,
  normalizeGitHubRepoName,
  prepareLocalBranch,
  verifyGithubConnection,
  getGitHubApiBase,
} from "@/ipc/handlers/github_handlers";
import { createAppOperationHandler } from "@/ipc/utils/app_mutation_lock";
import { DyadErrorKind } from "@/errors/dyad_error";
import { db } from "@/db";
import {
  gitCheckout,
  gitListBranches,
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
    "https://github.com/acme/demo/",
  ])("accepts %s as the app's remote", async (remoteUrl) => {
    const succeed = vi.mocked(execGit).getMockImplementation()!;
    vi.mocked(execGit).mockImplementation(async (args, cwd) =>
      args[0] === "remote"
        ? ({ exitCode: 0, stdout: `${remoteUrl}\n`, stderr: "" } as never)
        : succeed(args, cwd),
    );
    await expect(verifyGithubConnection({ appId: 1 })).resolves.toEqual({
      owner: "acme",
      repo: "demo",
      branch: "feature/deploy",
    });
  });

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
