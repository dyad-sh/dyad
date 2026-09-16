import { describe, expect, it } from "vitest";
import {
  gitLabInstanceLabel,
  isGitLabInstanceUrl,
  normalizeGitLabInstanceUrl,
} from "./gitlab_instance_url";

describe("normalizeGitLabInstanceUrl", () => {
  it("collapses spellings of one instance to one string", () => {
    expect(normalizeGitLabInstanceUrl("https://gitlab.com")).toBe(
      "https://gitlab.com",
    );
    expect(normalizeGitLabInstanceUrl("https://gitlab.com/")).toBe(
      "https://gitlab.com",
    );
    expect(normalizeGitLabInstanceUrl("  https://GitLab.com//  ")).toBe(
      "https://gitlab.com",
    );
    expect(normalizeGitLabInstanceUrl("https://gitlab.com/?x=1#frag")).toBe(
      "https://gitlab.com",
    );
  });

  it("keeps a port and a relative URL root", () => {
    expect(
      normalizeGitLabInstanceUrl("https://code.example.com:8443/gitlab/"),
    ).toBe("https://code.example.com:8443/gitlab");
  });

  it("throws on something that is not a URL", () => {
    expect(() => normalizeGitLabInstanceUrl("gitlab")).toThrow();
  });
});

describe("isGitLabInstanceUrl", () => {
  it("accepts http and https only", () => {
    expect(isGitLabInstanceUrl("https://gitlab.com")).toBe(true);
    expect(isGitLabInstanceUrl("http://10.0.0.5")).toBe(true);
    expect(isGitLabInstanceUrl("ssh://gitlab.com")).toBe(false);
    expect(isGitLabInstanceUrl("gitlab.com")).toBe(false);
    expect(isGitLabInstanceUrl("")).toBe(false);
  });
});

describe("gitLabInstanceLabel", () => {
  it("shows the host, with port and path when present", () => {
    expect(gitLabInstanceLabel("https://gitlab.com")).toBe("gitlab.com");
    expect(gitLabInstanceLabel("https://code.example.com:8443/gitlab")).toBe(
      "code.example.com:8443/gitlab",
    );
    expect(gitLabInstanceLabel("not a url")).toBe("not a url");
  });
});
