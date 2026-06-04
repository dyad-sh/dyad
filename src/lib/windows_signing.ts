import fs from "node:fs/promises";
import path from "node:path";

export const UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS = [
  "node_modules/node-pty/deps/winpty/misc/DebugServer.ps1",
  "node_modules/node-pty/deps/winpty/misc/ShowConsole.ps1",
  "node_modules/node-pty/prebuilds/darwin-arm64",
  "node_modules/node-pty/prebuilds/darwin-x64",
  "node_modules/node-pty/bin",
] as const;

async function rmIfExists(filePath: string): Promise<void> {
  await fs.rm(filePath, { force: true, recursive: true });
}

export async function removeUnsupportedWindowsSigningFiles(
  buildPath: string,
): Promise<void> {
  await Promise.all(
    UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS.map((relativePath) =>
      rmIfExists(path.join(buildPath, relativePath)),
    ),
  );
}
