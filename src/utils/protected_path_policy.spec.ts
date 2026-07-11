import { describe, expect, it } from "vitest";
import { isProtectedPath } from "./protected_path_policy";

describe("protected path policy", () => {
  it.each([".env", ".env.local", ".env.production.local", "nested/.env.test"])(
    "protects %s",
    (filePath) => {
      expect(isProtectedPath(filePath)).toBe(true);
    },
  );

  it("protects long dot-heavy env paths without regex blowups", () => {
    const adversarialPath = `nested/.env.${"..".repeat(10_000)}/config`;

    expect(isProtectedPath(adversarialPath)).toBe(true);
  });

  it("does not protect ordinary .environment files", () => {
    expect(isProtectedPath("src/.environment-setup.md")).toBe(false);
  });
});
