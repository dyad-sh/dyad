import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { calculateFileChecksum } from "@/utils/file_checksum";

describe("calculateFileChecksum", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-checksum-test-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("hashes files across multiple stream chunks", async () => {
    const file = path.join(dir, "database.sqlite");
    const contents = Buffer.concat([
      Buffer.alloc(64 * 1024, 0x11),
      Buffer.alloc(64 * 1024, 0x22),
      Buffer.alloc(17, 0x33),
    ]);
    fs.writeFileSync(file, contents);

    await expect(calculateFileChecksum(file)).resolves.toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
  });

  it("streams a large sparse database without materializing the file", async () => {
    const file = path.join(dir, "large.sqlite");
    const fd = fs.openSync(file, "w");
    try {
      fs.ftruncateSync(fd, 128 * 1024 * 1024);
      fs.writeSync(
        fd,
        Buffer.from("sqlite-tail"),
        0,
        11,
        128 * 1024 * 1024 - 11,
      );
    } finally {
      fs.closeSync(fd);
    }

    const checksum = await calculateFileChecksum(file);
    expect(checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(fs.statSync(file).size).toBe(128 * 1024 * 1024);
  }, 30_000);

  it("closes the stream when hashing fails", async () => {
    const missing = path.join(dir, "missing.sqlite");
    await expect(calculateFileChecksum(missing)).rejects.toThrow();

    // A subsequent file operation succeeds; in particular this catches open
    // handles on Windows, where leaked file streams prevent cleanup/rename.
    fs.writeFileSync(missing, "created after failure");
    fs.renameSync(missing, `${missing}.moved`);
  });
});
