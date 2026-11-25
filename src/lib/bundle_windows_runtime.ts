import fs from "node:fs/promises";
import path from "node:path";

/**
 * The MustardScript Windows addon links the MSVC runtime dynamically and
 * imports VCRUNTIME140.dll. On machines without the Visual C++ Redistributable
 * it cannot load, and the sandbox fails with "Unable to locate a MustardScript
 * native addon" (issue #5079). Windows searches the addon's own folder first,
 * so we ship the build machine's copy next to it (app-local deployment, which
 * Microsoft allows for the VC++ runtime).
 */
export async function bundleMustardscriptWindowsRuntime(
  appPath: string,
  platform: string,
  arch: string,
  sourceDir = path.join(process.env.SystemRoot ?? "C:\\Windows", "System32"),
): Promise<void> {
  // Only win32-x64 has a MustardScript binding (see isSandboxSupportedPlatform).
  if (platform !== "win32" || arch !== "x64") {
    return;
  }
  const addonDir = path.join(
    appPath,
    "node_modules",
    "@mustardscript",
    "binding-win32-x64-msvc",
  );
  // No try/catch: a build machine without the runtime must fail the build.
  await fs.copyFile(
    path.join(sourceDir, "vcruntime140.dll"),
    path.join(addonDir, "vcruntime140.dll"),
  );
}
