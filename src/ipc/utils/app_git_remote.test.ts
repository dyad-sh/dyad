import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => settings.current,
}));

import {
  getAppGitRemoteAuth,
  getGitHubRemoteAuth,
  githubRemote,
  hasAppGitRemote,
  requireAppGitRemote,
  resolveAppGitRemote,
} from "./app_git_remote";

describe("resolveAppGitRemote", () => {
  it("returns null for an app without a linked repository", () => {
    expect(resolveAppGitRemote({})).toBeNull();
    expect(
      resolveAppGitRemote({ githubOrg: "owner", githubRepo: null }),
    ).toBeNull();
    expect(hasAppGitRemote({ githubOrg: null, githubRepo: "repo" })).toBe(
      false,
    );
  });

  it("describes a GitHub repository with every URL a consumer needs", () => {
    const remote = resolveAppGitRemote({
      githubOrg: "owner",
      githubRepo: "repo",
      githubBranch: "release",
    });

    expect(remote).toEqual({
      provider: "github",
      providerLabel: "GitHub",
      owner: "owner",
      repo: "repo",
      branch: "release",
      displayPath: "owner/repo",
      httpsUrl: "https://github.com/owner/repo.git",
      sshUrl: "git@github.com:owner/repo.git",
    });
  });

  it("defaults the branch to main", () => {
    expect(githubRemote({ owner: "o", repo: "r" }).branch).toBe("main");
    expect(githubRemote({ owner: "o", repo: "r", branch: null }).branch).toBe(
      "main",
    );
    expect(githubRemote({ owner: "o", repo: "r", branch: "" }).branch).toBe(
      "main",
    );
  });
});

describe("requireAppGitRemote", () => {
  it("throws the message the GitHub handlers have always used", () => {
    expect(() => requireAppGitRemote({})).toThrow(
      "App is not linked to a GitHub repo.",
    );
  });
});

describe("remote auth", () => {
  beforeEach(() => {
    settings.current = {};
  });

  it("is null while GitHub is not connected", () => {
    expect(getGitHubRemoteAuth()).toBeNull();
  });

  it("binds the GitHub token to github.com as the basic-auth user", () => {
    settings.current = { githubAccessToken: { value: "gh-token" } };

    expect(getGitHubRemoteAuth()).toEqual({
      hostUrl: "https://github.com",
      username: "gh-token",
      password: "x-oauth-basic",
    });
  });

  it("refuses to authenticate a remote whose provider is not connected", () => {
    const remote = githubRemote({ owner: "o", repo: "r" });

    expect(() => getAppGitRemoteAuth(remote)).toThrow(
      "Not authenticated with GitHub.",
    );
  });
});
