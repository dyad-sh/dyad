import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filterLogLines, readRecentLogLines } from "./log_level_filter";

const log = (...lines: string[]) => lines.join("\n");

describe("filterLogLines", () => {
  it("drops the continuation lines of an info entry", () => {
    const content = log(
      "[2026-10-30 10:00:00.000] [info]  (catalog) Refreshed catalog {",
      "  source: 'remote',",
      "  hasProviderModels: false",
      "}",
      "[2026-10-30 10:00:01.000] [warn]  (git) Sync failed",
    );

    expect(filterLogLines(content, "warn")).toEqual([
      "[2026-10-30 10:00:01.000] [warn]  (git) Sync failed",
    ]);
  });

  it("keeps the stack trace of an error entry", () => {
    const content = log(
      "[2026-10-30 10:00:00.000] [error] (git) Push failed: Error: boom",
      "    at push (git_utils.ts:1:1)",
      "[2026-10-30 10:00:01.000] [debug] (git) Done",
      "    at notAnError (git_utils.ts:2:2)",
    );

    expect(filterLogLines(content, "warn")).toEqual([
      "[2026-10-30 10:00:00.000] [error] (git) Push failed: Error: boom",
      "    at push (git_utils.ts:1:1)",
    ]);
  });

  it("drops an orphaned continuation at the start of a rotated file", () => {
    const content = log(
      "  source: 'remote',",
      "}",
      "[2026-10-30 10:00:00.000] [warn]  (git) Sync failed",
    );

    expect(filterLogLines(content, "warn")).toEqual([
      "[2026-10-30 10:00:00.000] [warn]  (git) Sync failed",
    ]);
  });

  it("does not spend lines on blanks", () => {
    const content = "[2026-10-30 10:00:00.000] [warn]  (git) Sync failed\n\n";

    expect(filterLogLines(content, "warn")).toEqual([
      "[2026-10-30 10:00:00.000] [warn]  (git) Sync failed",
    ]);
  });

  it("does not read a level from the middle of a continuation line", () => {
    const content = log(
      "[2026-10-30 10:00:00.000] [info]  (app) Relaying app output:",
      "  child said [12:00] [warn] slow build",
    );

    expect(filterLogLines(content, "warn")).toEqual([]);
  });

  it("returns every line at info level", () => {
    const content = log(
      "[2026-10-30 10:00:00.000] [debug] (catalog) Refreshed {",
      "}",
    );

    expect(filterLogLines(content, "info")).toEqual(content.split("\n"));
  });
});

describe("readRecentLogLines", () => {
  const warning = (n: number) =>
    `[2026-10-31 11:00:0${n}.000] [warn]  (git) Warning ${n}`;
  let dir: string;
  let logPath: string;
  let archivePath: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "log-level-filter-"));
    logPath = path.join(dir, "main.log");
    archivePath = path.join(dir, "main.old.log");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("finds warnings moved to the archive by a rotation", () => {
    fs.writeFileSync(archivePath, `${warning(1)}\n`);
    fs.writeFileSync(
      logPath,
      "[2026-10-31 11:00:05.000] [debug] (git) Sync summary {\n}\n",
    );

    expect(readRecentLogLines(logPath, 20, "warn")).toEqual([warning(1)]);
  });

  it("puts archived lines before current ones", () => {
    fs.writeFileSync(archivePath, `${warning(1)}\n`);
    fs.writeFileSync(logPath, `${warning(2)}\n`);

    expect(readRecentLogLines(logPath, 20, "warn")).toEqual([
      warning(1),
      warning(2),
    ]);
  });

  it("does not use the archive once the current file fills the limit", () => {
    fs.writeFileSync(archivePath, `${warning(1)}\n`);
    fs.writeFileSync(logPath, `${warning(2)}\n${warning(3)}\n`);

    expect(readRecentLogLines(logPath, 2, "warn")).toEqual([
      warning(2),
      warning(3),
    ]);
  });

  it("keeps a stack trace split across the rotation with its error", () => {
    const error = "[2026-10-31 11:00:01.000] [error] (git) Push failed";
    const frame = "    at push (git_utils.ts:1:1)";
    fs.writeFileSync(archivePath, `${error}\n`);
    fs.writeFileSync(logPath, `${frame}\n`);

    expect(readRecentLogLines(logPath, 20, "warn")).toEqual([error, frame]);
  });

  it("tops up info-level reads from the archive too", () => {
    fs.writeFileSync(archivePath, "archived\n");
    fs.writeFileSync(logPath, "current\n");

    expect(readRecentLogLines(logPath, 3, "info")).toEqual([
      "archived",
      "current",
      "",
    ]);
  });

  it("reads the current file when there is no archive", () => {
    fs.writeFileSync(logPath, `${warning(1)}\n`);

    expect(readRecentLogLines(logPath, 20, "warn")).toEqual([warning(1)]);
  });

  it("returns nothing when neither file has warnings or exists", () => {
    expect(readRecentLogLines(logPath, 20, "warn")).toEqual([]);
  });
});
