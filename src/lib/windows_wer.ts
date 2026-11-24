import { rename } from "node:fs/promises";
import path from "node:path";

// Electron 45 looks for <executable>_wer.dll. Packager 18 renames the EXE
// without renaming this new helper; do it before Packager signs the directory.
export async function renameWindowsWerHelper(
  buildPath: string,
  platform: string,
  executableName: string,
): Promise<void> {
  if (platform !== "win32") return;
  await rename(
    path.join(buildPath, "electron_wer.dll"),
    path.join(buildPath, `${executableName}_wer.dll`),
  );
}
