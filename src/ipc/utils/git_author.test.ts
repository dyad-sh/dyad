import { beforeEach, describe, expect, it, vi } from "vitest";

const settings = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

vi.mock("../../main/settings", () => ({
  readSettings: () => settings.current,
}));

const githubUser = vi.hoisted(() => ({
  value: null as { email: string } | null,
}));
vi.mock("../handlers/github_handlers", () => ({
  getGithubUser: async () => githubUser.value,
}));

import { getGitAuthor } from "./git_author";

describe("getGitAuthor", () => {
  beforeEach(() => {
    settings.current = {};
    githubUser.value = null;
  });

  it("falls back to Dyad's own address when no provider is connected", async () => {
    expect(await getGitAuthor()).toEqual({
      name: "Dyad",
      email: "git@dyad.sh",
    });
  });

  it("uses the GitLab account for a user who only has GitLab", async () => {
    // GitLab attributes a commit to an account by author email. Stamping
    // git@dyad.sh left a GitLab-only user's work unattributed on their own
    // project, and a committer-email push rule rejects it outright.
    settings.current = { gitlab: { user: { email: "rene@example.com" } } };

    expect((await getGitAuthor()).email).toBe("rene@example.com");
  });

  it("keeps GitHub first for an account connected to both", async () => {
    githubUser.value = { email: "rene@github.example" };
    settings.current = { gitlab: { user: { email: "rene@gitlab.example" } } };

    expect((await getGitAuthor()).email).toBe("rene@github.example");
  });

  it("ignores a GitLab connection that reported no address", async () => {
    settings.current = { gitlab: { user: { username: "rene", email: null } } };

    expect((await getGitAuthor()).email).toBe("git@dyad.sh");
  });
});
