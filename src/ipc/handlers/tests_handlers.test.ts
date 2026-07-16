import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  listSpecFiles,
  migrateLegacyDyadTestsDir,
  normalizeRunTestFile,
} from "./tests_handlers";

const tmpRoots: string[] = [];

async function makeAppDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "dyad-tests-handler-"));
  tmpRoots.push(dir);
  return dir;
}

async function writeFile(root: string, relativePath: string, content: string) {
  const filePath = path.join(root, relativePath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content);
}

async function exists(root: string, relativePath: string) {
  try {
    await fs.access(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

describe("tests handlers spec paths", () => {
  afterEach(async () => {
    await Promise.all(
      tmpRoots
        .splice(0)
        .map((dir) => fs.rm(dir, { recursive: true, force: true })),
    );
  });

  it("accepts only e2e-tests spec paths for targeted runs", () => {
    expect(normalizeRunTestFile("e2e-tests/home.spec.ts")).toBe(
      "e2e-tests/home.spec.ts",
    );
    expect(normalizeRunTestFile("tests/home.spec.ts")).toBeNull();
    expect(normalizeRunTestFile("e2e-tests/../home.spec.ts")).toBeNull();
    expect(normalizeRunTestFile("e2e-tests/-home.spec.ts")).toBeNull();
  });

  it("migrates legacy Dyad specs and fixtures while leaving user tests alone", async () => {
    const appDir = await makeAppDir();
    await writeFile(
      appDir,
      "tests/home.spec.ts",
      'import { test, expect } from "@playwright/test";\nimport { signIn } from "./fixtures/test-user";',
    );
    await writeFile(
      appDir,
      "tests/fixtures/test-user.ts",
      "export const signIn = async () => {};",
    );
    await writeFile(appDir, "tests/math.test.ts", "test('unit', () => {});");

    await migrateLegacyDyadTestsDir(appDir);

    expect(await exists(appDir, "e2e-tests/home.spec.ts")).toBe(true);
    expect(await exists(appDir, "e2e-tests/fixtures/test-user.ts")).toBe(true);
    expect(await exists(appDir, "tests/home.spec.ts")).toBe(false);
    expect(await exists(appDir, "tests/fixtures/test-user.ts")).toBe(false);
    expect(await exists(appDir, "tests/math.test.ts")).toBe(true);
    await expect(listSpecFiles(appDir)).resolves.toEqual([
      "e2e-tests/home.spec.ts",
    ]);
  });

  it("does not migrate an existing user-owned tests directory without Playwright specs", async () => {
    const appDir = await makeAppDir();
    await writeFile(appDir, "tests/home.spec.ts", "test('home', () => {});");

    await migrateLegacyDyadTestsDir(appDir);

    expect(await exists(appDir, "tests/home.spec.ts")).toBe(true);
    expect(await exists(appDir, "e2e-tests/home.spec.ts")).toBe(false);
    await expect(listSpecFiles(appDir)).resolves.toEqual([]);
  });

  it("does not migrate legacy Playwright specs with non-ts extensions", async () => {
    const appDir = await makeAppDir();
    await writeFile(
      appDir,
      "tests/home.spec.tsx",
      'import { test } from "@playwright/test";',
    );
    await writeFile(
      appDir,
      "tests/about.spec.js",
      'import { test } from "@playwright/test";',
    );

    await migrateLegacyDyadTestsDir(appDir);

    expect(await exists(appDir, "tests/home.spec.tsx")).toBe(true);
    expect(await exists(appDir, "tests/about.spec.js")).toBe(true);
    expect(await exists(appDir, "e2e-tests/home.spec.tsx")).toBe(false);
    expect(await exists(appDir, "e2e-tests/about.spec.js")).toBe(false);
    await expect(listSpecFiles(appDir)).resolves.toEqual([]);
  });
});
