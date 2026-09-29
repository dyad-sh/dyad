import { afterEach, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("electron-log", () => ({ default: { scope: () => ({ warn }) } }));
import {
  createTestRunArtifactsDir,
  pruneTestRunArtifacts,
} from "./test_run_artifacts";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0))
    await fs.rm(root, { recursive: true, force: true });
});
async function makeRoot() {
  const root = await fs.mkdtemp(
    path.join(os.tmpdir(), "dyad-queue-artifacts-"),
  );
  roots.push(root);
  return root;
}

it("allocates without pruning and expires only old, explicitly owned runs when asked", async () => {
  const root = await makeRoot();
  const old = await createTestRunArtifactsDir(root);
  await fs.writeFile(path.join(old, "error-context.md"), "old failure");
  await fs.utimes(old, new Date(0), new Date(0));
  const user = path.join(
    root,
    "test-results",
    "dyad-run-00000000-0000-4000-8000-000000000000",
  );
  const legacy = path.join(root, "test-results", "dyad-preview-user-notes");
  for (const dir of [user, legacy]) {
    await fs.mkdir(dir);
    await fs.utimes(dir, new Date(0), new Date(0));
  }
  const recent = await createTestRunArtifactsDir(root);
  await fs.writeFile(path.join(recent, "error-context.md"), "recent failure");
  expect(await fs.readFile(path.join(old, "error-context.md"), "utf8")).toBe(
    "old failure",
  );
  await pruneTestRunArtifacts(root, recent);
  await expect(fs.stat(old)).rejects.toMatchObject({ code: "ENOENT" });
  expect((await fs.stat(user)).isDirectory()).toBe(true);
  expect((await fs.stat(legacy)).isDirectory()).toBe(true);
  expect(await fs.readFile(path.join(recent, "error-context.md"), "utf8")).toBe(
    "recent failure",
  );
});

it("logs listing failures without preventing subsequent artifact allocation", async () => {
  const root = await makeRoot();
  warn.mockClear();
  const error = Object.assign(new Error("permission denied"), {
    code: "EACCES",
  });
  vi.spyOn(fs, "readdir").mockRejectedValueOnce(error);
  const current = await createTestRunArtifactsDir(root);
  await expect(pruneTestRunArtifacts(root, current)).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith(
    "Could not prune old test artifacts",
    error,
  );
  const directory = await createTestRunArtifactsDir(root);
  expect((await fs.stat(directory)).isDirectory()).toBe(true);
});

it("preserves the current run even when its directory predates the retention cutoff", async () => {
  const root = await makeRoot();
  const previous = await createTestRunArtifactsDir(root);
  const current = await createTestRunArtifactsDir(root);
  await fs.writeFile(path.join(current, "results.json"), "current results");
  for (const directory of [previous, current])
    await fs.utimes(directory, new Date(0), new Date(0));
  await pruneTestRunArtifacts(root, current);
  await expect(fs.stat(previous)).rejects.toMatchObject({ code: "ENOENT" });
  expect(await fs.readFile(path.join(current, "results.json"), "utf8")).toBe(
    "current results",
  );
});
