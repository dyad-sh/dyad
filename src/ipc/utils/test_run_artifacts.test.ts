import { afterEach, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTestRunArtifactsDir } from "./test_run_artifacts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

it("preserves the previous run's failure artifacts and prunes only old Dyad directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-queue-artifacts-"));
  roots.push(root);
  const first = createTestRunArtifactsDir(root);
  fs.writeFileSync(path.join(first, "error-context.md"), "first failure");
  const old = path.join(root, "test-results", "dyad-preview-old");
  const user = path.join(root, "test-results", "user-results");
  fs.mkdirSync(old);
  fs.mkdirSync(user);
  fs.utimesSync(old, new Date(0), new Date(0));
  fs.utimesSync(user, new Date(0), new Date(0));
  const second = createTestRunArtifactsDir(root);
  expect(second).not.toBe(first);
  expect(fs.readFileSync(path.join(first, "error-context.md"), "utf8")).toBe(
    "first failure",
  );
  expect(fs.existsSync(old)).toBe(false);
  expect(fs.existsSync(user)).toBe(true);
});
