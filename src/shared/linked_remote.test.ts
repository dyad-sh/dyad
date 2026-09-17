import { describe, expect, it } from "vitest";
import { describeLinkedRemote } from "./linked_remote";

describe("describeLinkedRemote", () => {
  it("is null for an unlinked or missing app", () => {
    expect(describeLinkedRemote(null)).toBeNull();
    expect(describeLinkedRemote({})).toBeNull();
    expect(describeLinkedRemote({ githubOrg: "o" })).toBeNull();
    expect(
      describeLinkedRemote({
        gitlabHost: "https://gitlab.com",
        gitlabProjectId: 1,
      }),
    ).toBeNull();
  });

  it("describes a GitHub repository", () => {
    expect(
      describeLinkedRemote({
        githubOrg: "acme",
        githubRepo: "demo",
        githubBranch: "main",
      }),
    ).toEqual({
      provider: "github",
      providerLabel: "GitHub",
      owner: "acme",
      repo: "demo",
      displayPath: "acme/demo",
      webUrl: "https://github.com/acme/demo",
      branch: "main",
      host: null,
    });
  });

  it("describes a GitLab project and names a self-hosted instance", () => {
    expect(
      describeLinkedRemote({
        gitlabHost: "https://gitlab.example.com/",
        gitlabProjectId: 9,
        gitlabProjectPath: "team/demo",
        gitlabBranch: null,
      }),
    ).toEqual({
      provider: "gitlab",
      providerLabel: "GitLab (gitlab.example.com)",
      projectId: 9,
      projectPath: "team/demo",
      displayPath: "team/demo",
      webUrl: "https://gitlab.example.com/team/demo",
      branch: null,
      // The trailing slash is stripped: this host is also what the main
      // process resolves the remote from, so the two must not differ.
      host: "https://gitlab.example.com",
    });
    expect(
      describeLinkedRemote({
        gitlabHost: "https://gitlab.com",
        gitlabProjectId: 9,
        gitlabProjectPath: "me/demo",
      })?.providerLabel,
    ).toBe("GitLab");
  });
});
