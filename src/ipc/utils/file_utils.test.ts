import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getFilesRecursively } from "./file_utils";

describe("getFilesRecursively", () => {
  let tempDir: string | undefined;

  afterEach(() => {
    if (tempDir) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      tempDir = undefined;
    }
  });

  it("returns sorted relative paths with forward slashes", () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "file-utils-test-"));
    fs.mkdirSync(path.join(tempDir, "z-dir"), { recursive: true });
    fs.mkdirSync(path.join(tempDir, "a-dir"), { recursive: true });
    fs.writeFileSync(path.join(tempDir, "z-dir", "b.txt"), "b");
    fs.writeFileSync(path.join(tempDir, "a-dir", "c.txt"), "c");
    fs.writeFileSync(path.join(tempDir, "root.txt"), "root");

    expect(getFilesRecursively(tempDir, tempDir)).toEqual([
      "a-dir/c.txt",
      "root.txt",
      "z-dir/b.txt",
    ]);
  });
});
