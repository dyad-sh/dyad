import { sanitizeAppFolderName } from "@/shared/sanitizeAppFolderName";
import { describe, it, expect } from "vitest";

describe("sanitizeAppFolderName", () => {
  it("passes through valid names unchanged", () => {
    expect(sanitizeAppFolderName("my-app")).toBe("my-app");
    expect(sanitizeAppFolderName("My Awesome App")).toBe("My Awesome App");
  });

  it("replaces characters rejected by renameApp with dashes", () => {
    expect(sanitizeAppFolderName('weird<>:"|?*/\\name')).toBe(
      "weird---------name",
    );
  });

  it("strips ASCII control characters", () => {
    expect(sanitizeAppFolderName("name\x00with\x1fcontrol")).toBe(
      "namewithcontrol",
    );
  });

  it("collapses runs of whitespace", () => {
    expect(sanitizeAppFolderName("foo    bar\t\tbaz")).toBe("foo bar baz");
  });

  it("trims leading and trailing whitespace and dashes", () => {
    expect(sanitizeAppFolderName("   --foo--   ")).toBe("foo");
  });

  it("falls back to a default when sanitization produces an empty string", () => {
    expect(sanitizeAppFolderName("")).toBe("untitled-app");
    expect(sanitizeAppFolderName("///")).toBe("untitled-app");
    expect(sanitizeAppFolderName("   ")).toBe("untitled-app");
  });
});
