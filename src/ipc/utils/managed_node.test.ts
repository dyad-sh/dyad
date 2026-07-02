import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swapManagedNodeInstallDir } from "./managed_node";

vi.mock("electron", () => ({
  net: {
    request: vi.fn(),
  },
}));

describe("swapManagedNodeInstallDir", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-managed-node-"));
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it("restores the existing install when promoting the replacement fails", async () => {
    const finalInstallDir = path.join(testDir, "v24.18.0");
    const tempInstallDir = path.join(testDir, ".v24.18.0-temp");
    const backupInstallDir = path.join(testDir, ".v24.18.0-backup");
    await fsp.mkdir(finalInstallDir);
    await fsp.mkdir(tempInstallDir);
    await fsp.writeFile(path.join(finalInstallDir, "runtime.txt"), "old");
    await fsp.writeFile(path.join(tempInstallDir, "runtime.txt"), "new");

    const rename = vi.fn<typeof fsp.rename>(async (from, to) => {
      if (from === tempInstallDir && to === finalInstallDir) {
        throw Object.assign(new Error("EPERM: rename blocked"), {
          code: "EPERM",
        });
      }
      await fsp.rename(from, to);
    });

    await expect(
      swapManagedNodeInstallDir({
        tempInstallDir,
        finalInstallDir,
        backupInstallDir,
        rename,
      }),
    ).rejects.toThrow("rename blocked");

    await expect(
      fsp.readFile(path.join(finalInstallDir, "runtime.txt"), "utf8"),
    ).resolves.toBe("old");
    await expect(fsp.access(backupInstallDir)).rejects.toThrow();
    await expect(
      fsp.readFile(path.join(tempInstallDir, "runtime.txt"), "utf8"),
    ).resolves.toBe("new");
  });
});
