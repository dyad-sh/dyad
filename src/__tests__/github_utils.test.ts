import { normalizeGitHubRepoName } from "@/ipc/handlers/github_handlers";
import { describe, it, expect } from "vitest";

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

  it("should not modify names without spaces", () => {
    expect(normalizeGitHubRepoName("my-app")).toBe("my-app");
  });

  it("should handle empty string", () => {
    expect(normalizeGitHubRepoName("")).toBe("");
  });

  it("should handle leading and trailing spaces", () => {
    expect(normalizeGitHubRepoName(" my app ")).toBe("my-app");
  });

  it("should handle tabs as whitespace", () => {
    expect(normalizeGitHubRepoName("my\tapp")).toBe("my-app");
  });
});
