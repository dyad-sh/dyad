import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  removeUnsupportedWindowsSigningFiles,
  UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS,
} from "@/lib/windows_signing";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { force: true, recursive: true })),
  );
});

describe("removeUnsupportedWindowsSigningFiles", () => {
  it("removes the node-pty PowerShell scripts that signtool cannot sign", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-windows-signing-"),
    );
    tempDirectories.push(buildPath);

    for (const relativePath of UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS) {
      const absolutePath = path.join(buildPath, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, "Write-Host 'hello'\n");
    }

    await removeUnsupportedWindowsSigningFiles(buildPath);

    await Promise.all(
      UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS.map(async (relativePath) => {
        await expect(
          fs.stat(path.join(buildPath, relativePath)),
        ).rejects.toThrow();
      }),
    );
  });
});
