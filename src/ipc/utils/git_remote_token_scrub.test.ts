import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let appRows: { path: string }[] = [];
let appsBaseDir = "";

vi.mock("@/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(async () => appRows),
    })),
  },
}));

vi.mock("@/db/schema", () => ({
  apps: { path: "path" },
}));

vi.mock("@/paths/paths", () => ({
  getDyadAppPath: vi.fn((p: string) => path.join(appsBaseDir, p)),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    }),
  },
}));

import { scrubGithubTokenFromRemotes } from "./git_remote_token_scrub";

async function createAppWithGitConfig(
  appName: string,
  configContents: string,
): Promise<string> {
  const configPath = path.join(appsBaseDir, appName, ".git", "config");
  await fs.mkdir(path.dirname(configPath), { recursive: true });
  await fs.writeFile(configPath, configContents, "utf8");
  return configPath;
}

describe("scrubGithubTokenFromRemotes", () => {
  beforeEach(async () => {
    appsBaseDir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-token-scrub-"));
    appRows = [];
  });

  afterEach(async () => {
    await fs.rm(appsBaseDir, { recursive: true, force: true });
  });

  it("removes embedded credentials from GitHub remote URLs", async () => {
    const configPath = await createAppWithGitConfig(
      "my-app",
      [
        "[core]",
        "\trepositoryformatversion = 0",
        '[remote "origin"]',
        "\turl = https://gho_secret123:x-oauth-basic@github.com/owner/repo.git",
        "\tfetch = +refs/heads/*:refs/remotes/origin/*",
        "",
      ].join("\n"),
    );
    appRows = [{ path: "my-app" }];

    await scrubGithubTokenFromRemotes();

    const scrubbed = await fs.readFile(configPath, "utf8");
    expect(scrubbed).toContain("url = https://github.com/owner/repo.git");
    expect(scrubbed).not.toContain("gho_secret123");
    // The rest of the config is untouched
    expect(scrubbed).toContain("repositoryformatversion = 0");
    expect(scrubbed).toContain("fetch = +refs/heads/*:refs/remotes/origin/*");
  });

  it("leaves configs without embedded credentials unchanged", async () => {
    const original = [
      '[remote "origin"]',
      "\turl = https://github.com/owner/repo.git",
      "",
    ].join("\n");
    const configPath = await createAppWithGitConfig("clean-app", original);
    appRows = [{ path: "clean-app" }];

    await scrubGithubTokenFromRemotes();

    expect(await fs.readFile(configPath, "utf8")).toBe(original);
  });

  it("does not touch credentials for non-GitHub hosts", async () => {
    const original = [
      '[remote "origin"]',
      "\turl = https://user:pass@gitlab.com/owner/repo.git",
      "",
    ].join("\n");
    const configPath = await createAppWithGitConfig("gitlab-app", original);
    appRows = [{ path: "gitlab-app" }];

    await scrubGithubTokenFromRemotes();

    expect(await fs.readFile(configPath, "utf8")).toBe(original);
  });

  it("ignores apps without a .git/config", async () => {
    appRows = [{ path: "no-git-app" }];

    await expect(scrubGithubTokenFromRemotes()).resolves.toBeUndefined();
  });
});
