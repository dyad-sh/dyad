import { slugify, slugifyAppPath } from "@/shared/slugify";
import { describe, it, expect } from "vitest";

describe("slugify", () => {
  it("lowercases and replaces non-alphanumerics with single hyphens", () => {
    expect(slugify("My Cool App")).toBe("my-cool-app");
    expect(slugify("Hello, World!")).toBe("hello-world");
  });

  it("collapses runs of non-alphanumerics into one hyphen", () => {
    expect(slugify("a   b___c")).toBe("a-b-c");
  });

  it("strips leading and trailing hyphens", () => {
    expect(slugify("  --Trimmed--  ")).toBe("trimmed");
  });

  it("leaves already-kebab-case input unchanged", () => {
    expect(slugify("my-app")).toBe("my-app");
  });

  it("falls back to 'untitled' for empty / symbol-only input", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("!!!")).toBe("untitled");
  });

  it("truncates to 60 characters", () => {
    expect(slugify("a".repeat(100))).toBe("a".repeat(60));
  });

  it("strips a trailing hyphen left behind by truncation", () => {
    // The 60-char cut lands on the hyphen before "bcde", which must be removed
    // so the slug never ends in a dangling hyphen.
    expect(slugify("a".repeat(59) + "-bcde")).toBe("a".repeat(59));
  });
});

describe("slugifyAppPath", () => {
  it("splits camelCase boundaries", () => {
    expect(slugifyAppPath("DraftName")).toBe("draft-name");
    expect(slugifyAppPath("TaskMaster Pro")).toBe("task-master-pro");
  });

  it("splits acronym boundaries", () => {
    expect(slugifyAppPath("APIClient")).toBe("api-client");
    expect(slugifyAppPath("HTTPServer")).toBe("http-server");
  });

  it("handles names that are already kebab-case", () => {
    expect(slugifyAppPath("my-app")).toBe("my-app");
  });

  it("falls back to 'untitled' for empty input", () => {
    expect(slugifyAppPath("")).toBe("untitled");
  });

  it("produces output that is a valid Vercel project name", () => {
    for (const input of [
      "TaskMaster Pro",
      "APIClient",
      "  weird---name  ",
      "café déjà vu",
      "a".repeat(100),
    ]) {
      const result = slugifyAppPath(input);
      expect(result).toMatch(/^[a-z0-9-]+$/); // only lowercase, digits, hyphens
      expect(result).not.toMatch(/---/); // no triple hyphens
      expect(result).not.toMatch(/^-|-$/); // no leading/trailing hyphen
      expect(result.length).toBeLessThanOrEqual(100);
    }
  });
});
