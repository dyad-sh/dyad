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

  it("falls back for empty and bare-directory inputs", () => {
    expect(normalizeTestPath("")).toBe("tests/generated.spec.ts");
    expect(normalizeTestPath("tests")).toBe("tests/generated.spec.ts");
    expect(normalizeTestPath("../..")).toBe("tests/generated.spec.ts");
  });

  it("coerces non-spec filenames to unique spec names instead of one shared fallback", () => {
    // Two sibling tags with wrong extensions must not collapse onto the same
    // file (the second write would silently clobber the first).
    expect(normalizeTestPath("tests/login.test.ts")).toBe(
      "tests/login.test.spec.ts",
    );
    expect(normalizeTestPath("tests/checkout.test.ts")).toBe(
      "tests/checkout.test.spec.ts",
    );
    expect(normalizeTestPath("tests/signup.tsx")).toBe("tests/signup.spec.ts");
    expect(normalizeTestPath("tests/README.md")).toBe("tests/README.spec.ts");
  });

  it("preserves already-valid spec paths", () => {
    expect(normalizeTestPath("tests/login.spec.ts")).toBe(
      "tests/login.spec.ts",
    );
    expect(normalizeTestPath("login.spec.jsx")).toBe("tests/login.spec.jsx");
  });
});
