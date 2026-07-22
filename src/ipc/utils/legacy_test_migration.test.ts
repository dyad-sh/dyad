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

  it("includes every supported spec extension and ignores non-spec files", async () => {
    const appPath = makeApp({
      "tests/helper.ts": PLAYWRIGHT_SPEC, // not a *.spec file
      "tests/widget.spec.tsx": PLAYWRIGHT_SPEC,
      "tests/legacy.spec.js": PLAYWRIGHT_SPEC,
      "tests/legacy.spec.jsx": PLAYWRIGHT_SPEC,
      "tests/real.spec.ts": PLAYWRIGHT_SPEC,
    });
    expect(await detectLegacyPlaywrightSpecs(appPath)).toEqual([
      "tests/legacy.spec.js",
      "tests/legacy.spec.jsx",
      "tests/real.spec.ts",
      "tests/widget.spec.tsx",
    ]);
  });

  it("excludes a spec that only mentions @playwright/test in a comment", async () => {
    const appPath = makeApp({
      "tests/comment.spec.ts": `// This is not really a @playwright/test spec\nimport { test } from "vitest";\ntest("x", () => {});\n`,
      "tests/real.spec.ts": PLAYWRIGHT_SPEC,
    });
    expect(await detectLegacyPlaywrightSpecs(appPath)).toEqual([
      "tests/real.spec.ts",
    ]);
  });
});

describe("normalizeLegacyTestFile", () => {
  it("accepts a valid tests/*.spec.{ts,tsx,js,jsx} path", () => {
    expect(normalizeLegacyTestFile("tests/a.spec.ts")).toBe("tests/a.spec.ts");
    expect(normalizeLegacyTestFile("tests/sub/a.spec.ts")).toBe(
      "tests/sub/a.spec.ts",
    );
    expect(normalizeLegacyTestFile("tests/a.spec.tsx")).toBe(
      "tests/a.spec.tsx",
    );
    expect(normalizeLegacyTestFile("tests/a.spec.js")).toBe("tests/a.spec.js");
    expect(normalizeLegacyTestFile("tests/a.spec.jsx")).toBe(
      "tests/a.spec.jsx",
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
    expect(normalizeLegacyTestFile("tests/a.spec.mts")).toBeNull();
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
    expect(plan.movableSpecs).toEqual(["tests/signup.spec.ts"]);
    expect(plan.supportFiles).toEqual([
      "tests/fixtures/base.ts",
      "tests/fixtures/test-user.ts",
    ]);
    expect(plan.moveFiles.slice().sort()).toEqual([
      "tests/fixtures/base.ts",
      "tests/fixtures/test-user.ts",
      "tests/signup.spec.ts",
    ]);
    expect(plan.blockedSpecs).toEqual([]);
    expect(plan.skippedSupportFiles).toEqual([]);
  });

  it("blocks a spec that shares a fixture with an unselected spec", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures/shared"]),
      "tests/b.spec.ts": spec(["./fixtures/shared"]),
      "tests/fixtures/shared.ts": `export const shared = 1;\n`,
    });
    // Only a is selected; b stays and still needs the shared fixture, so
    // moving a (and leaving the fixture) would break a's import — block it.
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.movableSpecs).toEqual([]);
    expect(plan.moveFiles).toEqual([]);
    expect(plan.supportFiles).toEqual([]);
    expect(plan.blockedSpecs.map((b) => b.file)).toEqual(["tests/a.spec.ts"]);
    expect(plan.blockedSpecs[0].reason).toContain("didn't select");
    expect(plan.skippedSupportFiles).toEqual(["tests/fixtures/shared.ts"]);
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
    expect(plan.movableSpecs).toEqual(["tests/a.spec.ts", "tests/b.spec.ts"]);
    expect(plan.supportFiles).toEqual(["tests/fixtures/shared.ts"]);
    expect(plan.blockedSpecs).toEqual([]);
    expect(plan.skippedSupportFiles).toEqual([]);
  });

  it("blocks a spec whose transitive dependency is shared with a stay-behind spec", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures/helper"]),
      "tests/fixtures/helper.ts": `import "./deep";\nexport const h = 1;\n`,
      "tests/fixtures/deep.ts": `export const d = 1;\n`,
      // b (not selected) also depends on the deep fixture.
      "tests/b.spec.ts": spec(["./fixtures/deep"]),
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.movableSpecs).toEqual([]);
    expect(plan.blockedSpecs.map((b) => b.file)).toEqual(["tests/a.spec.ts"]);
    expect(plan.skippedSupportFiles).toEqual([
      "tests/fixtures/deep.ts",
      "tests/fixtures/helper.ts",
    ]);
  });

  it("blocks a spec whose fixture destination already exists", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures/shared"]),
      "tests/fixtures/shared.ts": `export const shared = 1;\n`,
      // A same-named fixture already lives at the destination.
      "e2e-tests/fixtures/shared.ts": `export const shared = 2;\n`,
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.movableSpecs).toEqual([]);
    expect(plan.blockedSpecs.map((b) => b.file)).toEqual(["tests/a.spec.ts"]);
    expect(plan.blockedSpecs[0].reason).toContain("already exists");
    expect(plan.skippedSupportFiles).toEqual(["tests/fixtures/shared.ts"]);
  });

  it("resolves a directory import to its index file", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./fixtures"]),
      "tests/fixtures/index.ts": `export const f = 1;\n`,
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.movableSpecs).toEqual(["tests/a.spec.ts"]);
    expect(plan.supportFiles).toEqual(["tests/fixtures/index.ts"]);
  });

  it("blocks a spec that imports another unselected spec", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["./b.spec"]),
      "tests/b.spec.ts": spec([]),
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.movableSpecs).toEqual([]);
    expect(plan.moveFiles).toEqual([]);
    expect(plan.blockedSpecs.map((b) => b.file)).toEqual(["tests/a.spec.ts"]);
  });

  it("ignores imports that escape tests/ or resolve to nothing", async () => {
    const appPath = makeApp({
      "tests/a.spec.ts": spec(["../src/app", "./missing", "@playwright/test"]),
    });
    const plan = await planLegacyMigration(appPath, ["tests/a.spec.ts"]);
    expect(plan.movableSpecs).toEqual(["tests/a.spec.ts"]);
    expect(plan.supportFiles).toEqual([]);
    expect(plan.moveFiles).toEqual(["tests/a.spec.ts"]);
    expect(plan.blockedSpecs).toEqual([]);
  });
});
