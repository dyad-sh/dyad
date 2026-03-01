import { describe, expect, it } from "vitest";
import {
  replaceSlashSkillReference,
  slugForPrompt,
} from "@/ipc/utils/replaceSlashSkillReference";

describe("replaceSlashSkillReference", () => {
  it("returns original when no slash-slug pattern present", () => {
    const input = "Hello world";
    const output = replaceSlashSkillReference(input, {
      webapp: "content",
    });
    expect(output).toBe(input);
  });

  it("returns original when promptsBySlug is empty", () => {
    const input = "/webapp-testing for the login page";
    const output = replaceSlashSkillReference(input, {});
    expect(output).toBe(input);
  });

  it("replaces /slug at start with content", () => {
    const input = "/webapp-testing for the login page";
    const promptsBySlug = { "webapp-testing": "Run E2E tests for the app." };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("Run E2E tests for the app. for the login page");
  });

  it("replaces /slug after space with content", () => {
    const input = "Please do /github-actions-debugging now";
    const promptsBySlug = {
      "github-actions-debugging": "Debug failing GitHub Actions workflows.",
    };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe(
      "Please do Debug failing GitHub Actions workflows. now",
    );
  });

  it("replaces multiple /slug occurrences", () => {
    const input = "/one and /two end";
    const promptsBySlug = { one: "First", two: "Second" };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("First and Second end");
  });

  it("leaves unknown slug intact", () => {
    const input = "/unknown-slug here";
    const promptsBySlug = { "other-slug": "Content" };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("/unknown-slug here");
  });

  it("does not replace slash in middle of path-like text", () => {
    const input = "path/to/file";
    const promptsBySlug = { path: "Nope", to: "Nope", file: "Nope" };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("path/to/file");
  });

  it("replaces /slug and preserves trailing space", () => {
    const input = "/webapp-testing extra";
    const promptsBySlug = { "webapp-testing": "Content" };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("Content extra");
  });

  it("matches case-sensitive slugs", () => {
    const input = "/FOO-Bar here";
    const promptsBySlug = { "FOO-Bar": "Matched", "foo-bar": "Wrong" };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("Matched here");
  });

  it("does not match different-cased slug", () => {
    const input = "/foo-bar here";
    const promptsBySlug = { "FOO-BAR": "Content" };
    const output = replaceSlashSkillReference(input, promptsBySlug);
    expect(output).toBe("/foo-bar here");
  });
});

describe("slugForPrompt", () => {
  it("returns explicit slug when set", () => {
    expect(slugForPrompt({ title: "My Prompt", slug: "custom" })).toBe(
      "custom",
    );
  });

  it("returns null when slug is null", () => {
    expect(slugForPrompt({ title: "Web App Testing", slug: null })).toBeNull();
  });

  it("returns null when slug is empty string", () => {
    expect(slugForPrompt({ title: "Web App Testing", slug: "" })).toBeNull();
  });
});
