import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("@/main/settings", () => ({
  readSettings: () => settings.current,
}));

import {
  assertCanLinkProvider,
  assertRemoteProvider,
  getAppGitRemoteAuth,
  getGitHubRemoteAuth,
  githubRemote,
  gitlabRemote,
  requireAppGitRemote,
  resolveAppGitRemote,
} from "./app_git_remote";

const gitlabApp = {
  gitlabHost: "https://gitlab.example.com/",
  gitlabProjectId: 9,
  gitlabProjectPath: "group/my-app",
  gitlabBranch: "develop",
};

describe("resolveAppGitRemote", () => {
  it("returns null for an app without a linked repository", () => {
    expect(resolveAppGitRemote({})).toBeNull();
    expect(
      resolveAppGitRemote({ githubOrg: "owner", githubRepo: null }),
    ).toBeNull();
    expect(
      resolveAppGitRemote({ githubOrg: null, githubRepo: "repo" }),
    ).toBeNull();
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

  it("describes a GitLab project with a normalized host", () => {
    expect(resolveAppGitRemote(gitlabApp)).toEqual({
      provider: "gitlab",
      providerLabel: "GitLab (gitlab.example.com)",
      host: "https://gitlab.example.com",
      projectId: 9,
      projectPath: "group/my-app",
      branch: "develop",
      displayPath: "group/my-app",
      httpsUrl: "https://gitlab.example.com/group/my-app.git",
    });
    expect(
      gitlabRemote({
        host: "https://gitlab.com",
        projectId: 1,
        projectPath: "me/app",
      }).providerLabel,
    ).toBe("GitLab");
  });

  it("needs host, project id and path before it counts as linked", () => {
    expect(
      resolveAppGitRemote({ ...gitlabApp, gitlabProjectId: null }),
    ).toBeNull();
    expect(resolveAppGitRemote({ ...gitlabApp, gitlabHost: "" })).toBeNull();
    // A project id of 0 is not a missing id.
    expect(
      resolveAppGitRemote({ ...gitlabApp, gitlabProjectId: 0 }),
    ).toMatchObject({ provider: "gitlab", projectId: 0 });
  });

  it("prefers GitHub when a row somehow carries both", () => {
    expect(
      resolveAppGitRemote({ ...gitlabApp, githubOrg: "o", githubRepo: "r" })
        ?.provider,
    ).toBe("github");
  });
});

describe("assertCanLinkProvider", () => {
  it("allows linking an unlinked app, or relinking the same provider", () => {
    expect(() => assertCanLinkProvider({}, "gitlab")).not.toThrow();
    expect(() => assertCanLinkProvider(gitlabApp, "gitlab")).not.toThrow();
  });

  it("refuses to link the other provider while one is linked", () => {
    expect(() => assertCanLinkProvider(gitlabApp, "github")).toThrow(
      /already linked to GitLab \(gitlab\.example\.com\) \(group\/my-app\)/,
    );
    expect(() =>
      assertCanLinkProvider({ githubOrg: "o", githubRepo: "r" }, "gitlab"),
    ).toThrow(/already linked to GitHub \(o\/r\)/);
  });
});

describe("assertRemoteProvider", () => {
  it("accepts a matching provider and an unstated one", () => {
    const remote = resolveAppGitRemote(gitlabApp)!;
    expect(() => assertRemoteProvider(remote, "gitlab")).not.toThrow();
    expect(() => assertRemoteProvider(remote, undefined)).not.toThrow();
  });

  it("refuses a provider the app is not linked to", () => {
    // A window holding a stale app row would otherwise be told its push
    // succeeded to a provider the push never touched.
    expect(() =>
      assertRemoteProvider(resolveAppGitRemote(gitlabApp)!, "github"),
    ).toThrow(
      /linked to GitLab \(gitlab\.example\.com\), but the request named GitHub/,
    );
  });
});

describe("requireAppGitRemote", () => {
  it("names no provider, so a GitLab user is not told about GitHub", () => {
    expect(() => requireAppGitRemote({})).toThrow(
      "App is not linked to a repository.",
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
    expect(() => getAppGitRemoteAuth(resolveAppGitRemote(gitlabApp)!)).toThrow(
      "Not authenticated with GitLab.",
    );
  });

  it("binds the GitLab token to the app's instance as the oauth2 password", () => {
    settings.current = {
      gitlab: {
        instanceUrl: "https://GitLab.example.com/",
        accessToken: { value: "glpat-secret" },
      },
    };

    expect(getAppGitRemoteAuth(resolveAppGitRemote(gitlabApp)!)).toEqual({
      hostUrl: "https://gitlab.example.com",
      username: "oauth2",
      password: "glpat-secret",
    });
  });

  it("refuses to push a GitLab app through a connection to another instance", () => {
    settings.current = {
      gitlab: {
        instanceUrl: "https://gitlab.com",
        accessToken: { value: "glpat-other" },
      },
    };

    expect(() => getAppGitRemoteAuth(resolveAppGitRemote(gitlabApp)!)).toThrow(
      /linked to group\/my-app on gitlab\.example\.com, but Dyad is connected to gitlab\.com/,
    );
  });
});
