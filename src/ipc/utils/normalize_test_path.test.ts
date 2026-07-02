import { describe, expect, it } from "vitest";
import { normalizeTestPath } from "./normalize_test_path";

describe("normalizeTestPath", () => {
  it("forces traversal attempts under tests", () => {
    expect(normalizeTestPath("../../../etc/passwd.spec.ts")).toBe(
      "tests/etc/passwd.spec.ts",
    );
    expect(normalizeTestPath("tests/../src/App.spec.ts")).toBe(
      "tests/src/App.spec.ts",
    );
  });

  it("resolves parent segments before sanitizing", () => {
    expect(normalizeTestPath("tests/foo/bar/../baz.spec.ts")).toBe(
      "tests/foo/baz.spec.ts",
    );
  });

  it("normalizes Windows separators", () => {
    expect(normalizeTestPath("tests\\auth\\login.spec.ts")).toBe(
      "tests/auth/login.spec.ts",
    );
  });

  it("falls back for empty, directory, and non-spec inputs", () => {
    expect(normalizeTestPath("")).toBe("tests/generated.spec.ts");
    expect(normalizeTestPath("tests")).toBe("tests/generated.spec.ts");
    expect(normalizeTestPath("tests/README.md")).toBe(
      "tests/generated.spec.ts",
    );
  });
});
