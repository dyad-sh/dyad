import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectLegacyPlaywrightSpecs,
  legacyToE2ePath,
  normalizeLegacyTestFile,
} from "./legacy_test_migration";

const tempDirs: string[] = [];

function makeApp(files: Record<string, string>): string {
  const appPath = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-legacy-"));
  tempDirs.push(appPath);
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(appPath, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return appPath;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

const PLAYWRIGHT_SPEC = `import { test, expect } from "@playwright/test";
test("works", async ({ page }) => {
  await page.goto("/");
});
`;
const VITEST_SPEC = `import { test, expect } from "vitest";
test("unit", () => {
  expect(1).toBe(1);
});
`;

describe("detectLegacyPlaywrightSpecs", () => {
  it("returns [] when tests/ does not exist", async () => {
    const appPath = makeApp({ "src/index.ts": "" });
    expect(await detectLegacyPlaywrightSpecs(appPath)).toEqual([]);
  });

  it("includes .spec.ts files that import @playwright/test, sorted", async () => {
    const appPath = makeApp({
      "tests/signup.spec.ts": PLAYWRIGHT_SPEC,
      "tests/nested/checkout.spec.ts": PLAYWRIGHT_SPEC,
    });
    expect(await detectLegacyPlaywrightSpecs(appPath)).toEqual([
      "tests/nested/checkout.spec.ts",
      "tests/signup.spec.ts",
    ]);
  });

  it("excludes .spec.ts files that do not import @playwright/test", async () => {
    const appPath = makeApp({
      "tests/unit.spec.ts": VITEST_SPEC,
      "tests/e2e.spec.ts": PLAYWRIGHT_SPEC,
    });
    expect(await detectLegacyPlaywrightSpecs(appPath)).toEqual([
      "tests/e2e.spec.ts",
    ]);
  });

  it("ignores non-spec files and non-.ts specs", async () => {
    const appPath = makeApp({
      "tests/helper.ts": PLAYWRIGHT_SPEC,
      "tests/widget.spec.tsx": PLAYWRIGHT_SPEC,
      "tests/legacy.spec.js": PLAYWRIGHT_SPEC,
      "tests/real.spec.ts": PLAYWRIGHT_SPEC,
    });
    expect(await detectLegacyPlaywrightSpecs(appPath)).toEqual([
      "tests/real.spec.ts",
    ]);
  });
});

describe("normalizeLegacyTestFile", () => {
  it("accepts a valid tests/*.spec.ts path", () => {
    expect(normalizeLegacyTestFile("tests/a.spec.ts")).toBe("tests/a.spec.ts");
    expect(normalizeLegacyTestFile("tests/sub/a.spec.ts")).toBe(
      "tests/sub/a.spec.ts",
    );
  });

  it("normalizes backslashes to forward slashes", () => {
    expect(normalizeLegacyTestFile("tests\\a.spec.ts")).toBe("tests/a.spec.ts");
  });

  it("rejects traversal, absolute, non-spec, and non-tests paths", () => {
    expect(normalizeLegacyTestFile("tests/../secret.spec.ts")).toBeNull();
    expect(normalizeLegacyTestFile("/etc/tests/a.spec.ts")).toBeNull();
    expect(normalizeLegacyTestFile("e2e-tests/a.spec.ts")).toBeNull();
    expect(normalizeLegacyTestFile("tests/a.ts")).toBeNull();
    expect(normalizeLegacyTestFile("tests/a.spec.tsx")).toBeNull();
    expect(normalizeLegacyTestFile("tests/-flag.spec.ts")).toBeNull();
  });
});

describe("legacyToE2ePath", () => {
  it("swaps only the leading tests/ segment", () => {
    expect(legacyToE2ePath("tests/a.spec.ts")).toBe("e2e-tests/a.spec.ts");
    expect(legacyToE2ePath("tests/sub/a.spec.ts")).toBe(
      "e2e-tests/sub/a.spec.ts",
    );
  });
});
