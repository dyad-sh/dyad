import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { normalizeGitHubRepoName } from "@/ipc/handlers/github_handlers";
import { DyadErrorKind } from "@/errors/dyad_error";
import { apps } from "@/db/schema";
import {
  type HandlerTestHarness,
  setupHandlerTestHarness,
} from "@/testing/handler_test_harness";

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

// --- Handler tests: list-dyad-repos + clone dedupe path ---

// All app folders resolve under one throwaway base so the filesystem-probing
// name-collision checks in resolveAvailableAppName run against real dirs.
const TEMP_BASE = path.join(os.tmpdir(), "dyad-github-handler-tests");

// Mutable settings container the mocked readSettings() returns. Hoisted so the
// vi.mock factory (also hoisted) can close over it.
const settingsRef = vi.hoisted(() => ({
  current: {} as { githubAccessToken?: { value: string } },
}));

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "dyad-github-user-data")),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

vi.mock("node-fetch", () => ({ default: vi.fn() }));

vi.mock("@/main/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/main/settings")>();
  return {
    ...actual,
    readSettings: () => settingsRef.current,
    writeSettings: vi.fn(),
  };
});

vi.mock("@/paths/paths", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/paths/paths")>();
  const nodePath = await import("node:path");
  const nodeOs = await import("node:os");
  const base = nodePath.join(nodeOs.tmpdir(), "dyad-github-handler-tests");
  return {
    ...actual,
    getDyadAppPath: (appPath: string) =>
      nodePath.isAbsolute(appPath) ? appPath : nodePath.join(base, appPath),
    isAppLocationAccessible: () => true,
  };
});

vi.mock("@/ipc/utils/git_utils", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/ipc/utils/git_utils")>();
  return {
    ...actual,
    // Simulate a successful clone by materializing the destination folder so
    // downstream fs checks (AI_RULES.md probe) behave realistically.
    gitClone: vi.fn(async ({ path: dest }: { path: string }) => {
      await fs.promises.mkdir(dest, { recursive: true });
    }),
  };
});

import fetch from "node-fetch";
import { registerGithubHandlers } from "@/ipc/handlers/github_handlers";
import type { DyadGithubRepo, CloneRepoResult } from "@/ipc/types/github";

const mockFetch = vi.mocked(fetch);

interface FakeResponse {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
}

function fakeResponse(body: unknown, status = 200): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: async () => body,
  };
}

/**
 * Routes fetch calls by URL for the list-dyad-repos flow.
 * - `login`: value returned from GET /user
 * - `searchItems`: items array for the topic search
 * - `userRepos`: array returned from GET /user/repos
 * - `contents`: full_name -> HTTP status for the AI_RULES.md probe (default 404)
 */
function routeListDyadRepos(opts: {
  login?: string;
  searchItems?: any[];
  userRepos?: any[];
  contents?: Record<string, number>;
}) {
  mockFetch.mockImplementation((async (url: string) => {
    if (url.includes("/search/repositories")) {
      return fakeResponse({ items: opts.searchItems ?? [] });
    }
    if (url.includes("/user/repos")) {
      return fakeResponse(opts.userRepos ?? []);
    }
    if (url.includes("/contents/AI_RULES.md")) {
      const match = url.match(/\/repos\/([^/]+\/[^/]+)\/contents\//);
      const fullName = match?.[1] ?? "";
      const status = opts.contents?.[fullName] ?? 404;
      return fakeResponse(
        status === 200 ? { name: "AI_RULES.md" } : {},
        status,
      );
    }
    if (url.endsWith("/user")) {
      return fakeResponse({ login: opts.login ?? "octocat" });
    }
    throw new Error(`Unexpected fetch URL in test: ${url}`);
  }) as unknown as typeof fetch);
}

function repo(fullName: string, isPrivate = false) {
  const [, name] = fullName.split("/");
  return { name, full_name: fullName, private: isPrivate };
}

describe("github handlers", () => {
  let harness: HandlerTestHarness;

  beforeEach(() => {
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
    fs.mkdirSync(TEMP_BASE, { recursive: true });
    settingsRef.current = { githubAccessToken: { value: "gh-token" } };
    mockFetch.mockReset();
    harness = setupHandlerTestHarness();
    registerGithubHandlers();
  });

  afterEach(() => {
    harness.dispose();
    fs.rmSync(TEMP_BASE, { recursive: true, force: true });
  });

  function seedApp(name: string, appPath: string, github?: [string, string]) {
    harness.db
      .insert(apps)
      .values({
        name,
        path: appPath,
        githubOrg: github?.[0],
        githubRepo: github?.[1],
      })
      .run();
  }

  describe("list-dyad-repos", () => {
    it("throws an Auth DyadError when there is no GitHub token", async () => {
      settingsRef.current = {};

      await expect(
        harness.invokeHandler("github:list-dyad-repos"),
      ).rejects.toMatchObject({ kind: DyadErrorKind.Auth });
    });

    it("merges topic-search + AI_RULES heuristic, preserving order and flagging imported repos", async () => {
      // alpha & beta come from /user/repos (recently-updated order); gamma is
      // topic-tagged but outside that first page. alpha has AI_RULES.md, beta
      // does not (404), so beta is not a Dyad repo.
      routeListDyadRepos({
        login: "octocat",
        userRepos: [repo("octocat/alpha"), repo("octocat/beta")],
        searchItems: [repo("octocat/gamma")],
        contents: { "octocat/alpha": 200, "octocat/beta": 404 },
      });

      // A local app already linked to alpha -> alreadyImported.
      seedApp("Alpha", "alpha", ["octocat", "alpha"]);

      const result = await harness.invokeHandler<DyadGithubRepo[]>(
        "github:list-dyad-repos",
      );

      expect(result).toEqual([
        {
          name: "alpha",
          full_name: "octocat/alpha",
          private: false,
          alreadyImported: true,
        },
        {
          name: "gamma",
          full_name: "octocat/gamma",
          private: false,
          alreadyImported: false,
        },
      ]);
    });

    it("stops the AI_RULES scan on a non-404 status and never mislabels later repos", async () => {
      // 9 repos so the concurrency-8 scan needs a second batch. repo r1 returns
      // 403 (secondary rate limit) in the first batch, which must halt the scan
      // so r9 (second batch, has AI_RULES.md) is never probed -> excluded, not
      // silently mislabeled as absent.
      const userRepos = Array.from({ length: 9 }, (_, i) =>
        repo(`octocat/r${i + 1}`),
      );
      routeListDyadRepos({
        login: "octocat",
        userRepos,
        searchItems: [],
        contents: { "octocat/r1": 403, "octocat/r9": 200 },
      });

      const result = await harness.invokeHandler<DyadGithubRepo[]>(
        "github:list-dyad-repos",
      );

      // r9 would qualify but is never scanned once the scan stops.
      expect(result.map((r) => r.full_name)).not.toContain("octocat/r9");
      const probedUrls = mockFetch.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes("/contents/AI_RULES.md"));
      expect(probedUrls.some((u) => u.includes("/octocat/r9/"))).toBe(false);
    });
  });

  describe("clone-repo-from-url dedupeName", () => {
    beforeEach(() => {
      // No token: skip the remote repo-existence fetch and exercise the local
      // name-resolution path directly.
      settingsRef.current = {};
    });

    it("dedupes a colliding app name instead of failing when dedupeName is true", async () => {
      seedApp("myrepo", "myrepo");

      const result = await harness.invokeHandler<CloneRepoResult>(
        "github:clone-repo-from-url",
        {
          url: "https://github.com/octocat/myrepo.git",
          dedupeName: true,
          optimizeForDyad: false,
        },
      );

      expect(result).not.toHaveProperty("error");
      expect((result as { app: { name: string } }).app.name).toBe("myrepo-2");
    });

    it("skips folders occupied on disk with no app row when deduping", async () => {
      // No app row, but the base slug's folder already exists.
      fs.mkdirSync(path.join(TEMP_BASE, "myrepo"), { recursive: true });

      const result = await harness.invokeHandler<CloneRepoResult>(
        "github:clone-repo-from-url",
        {
          url: "https://github.com/octocat/myrepo.git",
          dedupeName: true,
          optimizeForDyad: false,
        },
      );

      expect((result as { app: { name: string } }).app.name).toBe("myrepo-2");
    });

    it("returns a collision error when dedupeName is false", async () => {
      seedApp("myrepo", "myrepo");

      const result = await harness.invokeHandler<CloneRepoResult>(
        "github:clone-repo-from-url",
        {
          url: "https://github.com/octocat/myrepo.git",
          dedupeName: false,
          optimizeForDyad: false,
        },
      );

      expect(result).toEqual({
        error: 'An app named "myrepo" already exists.',
      });
    });
  });
});
