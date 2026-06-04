import fs from "node:fs/promises";
import path from "node:path";

export const UNSUPPORTED_WINDOWS_SIGNING_RELATIVE_PATHS = [
  "node_modules/node-pty/deps/winpty/misc/ConinMode.ps1",
  "node_modules/node-pty/deps/winpty/misc/IdentifyConsoleWindow.ps1",
  "node_modules/node-pty/build/Release/.deps",
] as const;

async function rmIfExists(absolutePath: string): Promise<void> {
  try {
    await fs.rm(absolutePath, { force: true, recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return;
    }
    throw error;
  }
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
