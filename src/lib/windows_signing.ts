import fs from "node:fs/promises";
import path from "node:path";

export const UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS = [
  "node_modules/node-pty/deps/winpty/misc/ConinMode.ps1",
  "node_modules/node-pty/deps/winpty/misc/IdentifyConsoleWindow.ps1",
  "node_modules/node-pty/prebuilds/darwin-arm64",
  "node_modules/node-pty/prebuilds/darwin-x64",
  "node_modules/node-pty/bin",
] as const;

export async function removeUnsupportedWindowsSigningFiles(
  buildPath: string,
): Promise<void> {
  await Promise.all(
    UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS.map(async (relativePath) => {
      const absolutePath = path.join(buildPath, relativePath);
      await fs.rm(absolutePath, { force: true, recursive: true });
    }),
  );
}
