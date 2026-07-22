import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  detectLegacyPlaywrightSpecs,
  legacyToE2ePath,
  normalizeLegacyTestFile,
  parseRelativeImportSpecifiers,
  planLegacyMigration,
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

describe("parseRelativeImportSpecifiers", () => {
  it("extracts relative import/require specifiers and ignores externals", () => {
    const content = `
import { test } from "@playwright/test";
import { signIn } from "./fixtures/test-user";
import helper from "../helpers/util";
export { thing } from "./shared";
const x = require("./dyn");
const y = await import("./lazy");
import "./side-effect";
import type { T } from "./types";
`;
    expect(parseRelativeImportSpecifiers(content).sort()).toEqual(
      [
        "../helpers/util",
        "./dyn",
        "./fixtures/test-user",
        "./lazy",
        "./shared",
        "./side-effect",
        "./types",
      ].sort(),
    );
  });
});

describe("planLegacyMigration", () => {
  // A Playwright spec that side-effect-imports each of `imports`.
  const spec = (imports: string[]) =>
    `import { test, expect } from "@playwright/test";\n` +
    imports.map((i) => `import "${i}";`).join("\n") +
    `\ntest("t", async () => {});\n`;

  it("carries along fixtures a selected spec imports (transitively)", async () => {
    const appPath = makeApp({
      "tests/signup.spec.ts": spec(["./fixtures/test-user"]),
      "tests/fixtures/test-user.ts": `import "./base";\nexport const signIn = () => {};\n`,
      "tests/fixtures/base.ts": `export const base = 1;\n`,
    });
    const plan = await planLegacyMigration(appPath, ["tests/signup.spec.ts"]);
    expect(plan.supportFiles).toEqual([
      "tests/fixtures/base.ts",
      "tests/fixtures/test-user.ts",
    ]);
    expect(plan.moveFiles.sort()).toEqual([
      "tests/fixtures/base.ts",
      "tests/fixtures/test-user.ts",
      "tests/signup.spec.ts",
    ]);
    expect(plan.sharedLeftBehind).toEqual([]);
  });

  it("leaves a fixture shared with a spec that stays behind", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures/shared"]),
      "tests/b.spec.ts": spec(["./fixtures/shared"]),
      "tests/fixtures/shared.ts": `export const shared = 1;\n`,
    });
    // Only a moves; b stays and still needs the shared fixture.
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.supportFiles).toEqual([]);
    expect(plan.sharedLeftBehind).toEqual(["tests/fixtures/shared.ts"]);
    expect(plan.moveFiles).toEqual(["tests/a.spec.ts"]);
  });

  it("moves a shared fixture when all its importers are selected", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures/shared"]),
      "tests/b.spec.ts": spec(["./fixtures/shared"]),
      "tests/fixtures/shared.ts": `export const shared = 1;\n`,
    });
    const plan = await planLegacyMigration(appPath, [
      "tests/a.spec.ts",
      "tests/b.spec.ts",
    ]);
    expect(plan.supportFiles).toEqual(["tests/fixtures/shared.ts"]);
    expect(plan.sharedLeftBehind).toEqual([]);
  });

  it("resolves a directory import to its index file", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures"]),
      "tests/fixtures/index.ts": `export const f = 1;\n`,
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.supportFiles).toEqual(["tests/fixtures/index.ts"]);
  });

  it("never moves another spec file as a support file", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./b.spec"]),
      "tests/b.spec.ts": spec([]),
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.supportFiles).toEqual([]);
    expect(plan.moveFiles).toEqual(["tests/a.spec.ts"]);
  });

  it("ignores imports that escape tests/ or resolve to nothing", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["../src/app", "./missing", "@playwright/test"]),
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.supportFiles).toEqual([]);
    expect(plan.moveFiles).toEqual(["tests/a.spec.ts"]);
  });
});
