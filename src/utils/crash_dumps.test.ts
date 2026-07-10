import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  listDumpFiles,
  listDumpFilesRecursive,
  deleteDump,
  moveDump,
  pruneAndListNewestDumpFilesRecursive,
  pruneDumps,
} from "@/utils/crash_dumps";

describe("crash_dumps", () => {
  let dir: string;

  // Create a dump (+ .meta sidecar) with a controlled modification time so
  // newest-first ordering is deterministic.
  function makeDump(name: string, ageSeconds: number): string {
    const dump = path.join(dir, name);
    fs.writeFileSync(dump, "x");
    fs.writeFileSync(dump.replace(/\.dmp$/, ".meta"), "m");
    const t = Date.now() / 1000 - ageSeconds;
    fs.utimesSync(dump, t, t);
    return dump;
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "crash-dumps-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("lists only .dmp files, newest first", () => {
    makeDump("a.dmp", 30);
    makeDump("b.dmp", 10);
    makeDump("c.dmp", 20);
    fs.writeFileSync(path.join(dir, "notes.txt"), "ignore me");

    const files = listDumpFiles(dir).map((f) => path.basename(f));
    expect(files).toEqual(["b.dmp", "c.dmp", "a.dmp"]);
  });

  it("returns empty for a missing directory", () => {
    expect(listDumpFiles(path.join(dir, "nope"))).toEqual([]);
  });

  it("finds .dmp files in nested subdirs (pending/ and reports/), newest first", () => {
    // Mirror Crashpad's platform-specific layout: a dump under pending/ (Linux/
    // macOS) and one under reports/ (Windows). Both must be found.
    fs.mkdirSync(path.join(dir, "pending"));
    fs.mkdirSync(path.join(dir, "reports"));
    makeDump(path.join("pending", "a.dmp"), 30);
    makeDump(path.join("reports", "b.dmp"), 10);
    fs.writeFileSync(path.join(dir, "reports", "metadata"), "ignore");

    const files = listDumpFilesRecursive(dir).map((f) => path.basename(f));
    expect(files).toEqual(["b.dmp", "a.dmp"]);
  });

  it("bounds a large pending backlog to the newest dumps while scanning", () => {
    fs.mkdirSync(path.join(dir, "pending"));
    fs.mkdirSync(path.join(dir, "reports"));
    for (let i = 0; i < 30; i++) {
      const subdir = i % 2 === 0 ? "pending" : "reports";
      makeDump(path.join(subdir, `${i}.dmp`), i + 1);
    }

    const kept = pruneAndListNewestDumpFilesRecursive(dir, 5).map((file) =>
      path.basename(file),
    );

    expect(kept).toEqual(["0.dmp", "1.dmp", "2.dmp", "3.dmp", "4.dmp"]);
    expect(listDumpFilesRecursive(dir)).toHaveLength(5);
    expect(fs.existsSync(path.join(dir, "reports", "29.meta"))).toBe(false);
  });

  it("can drain a pending dump tree without retaining candidates", () => {
    fs.mkdirSync(path.join(dir, "pending"));
    makeDump(path.join("pending", "a.dmp"), 1);
    makeDump(path.join("pending", "b.dmp"), 2);

    expect(pruneAndListNewestDumpFilesRecursive(dir, 0)).toEqual([]);
    expect(listDumpFilesRecursive(dir)).toEqual([]);
  });

  it("leaves a dump untouched when its modification time cannot be read", () => {
    const dump = makeDump("still-rotating.dmp", 1);
    const statSpy = vi.spyOn(fs, "statSync").mockImplementation(() => {
      throw new Error("report rotated during stat");
    });

    expect(pruneAndListNewestDumpFilesRecursive(dir, 0)).toEqual([]);
    statSpy.mockRestore();
    expect(fs.existsSync(dump)).toBe(true);
    expect(fs.existsSync(dump.replace(/\.dmp$/, ".meta"))).toBe(true);
  });

  it("deletes a dump and its .meta sidecar", () => {
    const dump = makeDump("x.dmp", 1);
    deleteDump(dump);
    expect(fs.existsSync(dump)).toBe(false);
    expect(fs.existsSync(dump.replace(/\.dmp$/, ".meta"))).toBe(false);
  });

  it("moves a dump and its .meta sidecar to a new name", () => {
    const src = makeDump("a1b2c3d4.dmp", 1);
    const dest = path.join(dir, "crash-2026-06-07T00-00-00-000Z-a1b2c3d4.dmp");
    moveDump(src, dest);
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.existsSync(dest.replace(/\.dmp$/, ".meta"))).toBe(true);
  });

  it("deletes the source when the move fails, so it isn't reprocessed", () => {
    const src = makeDump("a1b2c3d4.dmp", 1);
    // Destination parent does not exist → rename fails. The source must still be
    // removed so the next launch doesn't read it again.
    moveDump(src, path.join(dir, "no-such-dir", "x.dmp"));
    expect(fs.existsSync(src)).toBe(false);
  });

  it("prunes to the N most-recent dumps", () => {
    makeDump("old1.dmp", 50);
    makeDump("old2.dmp", 40);
    makeDump("recent1.dmp", 20);
    makeDump("recent2.dmp", 10);

    pruneDumps(dir, 2);

    const remaining = listDumpFiles(dir)
      .map((f) => path.basename(f))
      .sort();
    expect(remaining).toEqual(["recent1.dmp", "recent2.dmp"]);
    // sidecars of pruned dumps are gone too
    expect(fs.existsSync(path.join(dir, "old1.meta"))).toBe(false);
  });

  it("prune is a no-op when under the limit", () => {
    makeDump("a.dmp", 5);
    pruneDumps(dir, 5);
    expect(listDumpFiles(dir)).toHaveLength(1);
  });
});
