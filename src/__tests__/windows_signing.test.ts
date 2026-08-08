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
  it("removes node-pty artifacts that Windows signtool should not touch", async () => {
    const buildPath = await fs.mkdtemp(
      path.join(os.tmpdir(), "dyad-windows-signing-"),
    );
    tempDirectories.push(buildPath);

    for (const relativePath of UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS) {
      const absolutePath = path.join(buildPath, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });

      if (path.extname(relativePath)) {
        await fs.writeFile(absolutePath, "Write-Host 'hello'\n");
      } else {
        await fs.mkdir(absolutePath, { recursive: true });
        await fs.writeFile(
          path.join(absolutePath, "placeholder.node"),
          "not-a-windows-binary",
        );
      }
    }

    const supportedWindowsBinary = path.join(
      buildPath,
      "node_modules/node-pty/prebuilds/win32-x64/pty.node",
    );
    await fs.mkdir(path.dirname(supportedWindowsBinary), { recursive: true });
    await fs.writeFile(supportedWindowsBinary, "windows-binary");

    await removeUnsupportedWindowsSigningFiles(buildPath);

    await Promise.all(
      UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS.map(async (relativePath) => {
        await expect(
          fs.stat(path.join(buildPath, relativePath)),
        ).rejects.toThrow();
      }),
    );

    await expect(fs.readFile(supportedWindowsBinary, "utf8")).resolves.toBe(
      "windows-binary",
    );
  });
});
