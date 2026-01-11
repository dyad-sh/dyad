import { MakerBase, MakerOptions } from "@electron-forge/maker-base";
import { execFile } from "child_process";
import {
  writeFile,
  appendFile,
  mkdtemp,
  mkdir,
  cp,
  symlink,
  chmod,
  readFile,
  copyFile,
  rm,
} from "fs/promises";
import { tmpdir } from "os";
import { promisify } from "util";
import { resolve, relative, extname } from "path";
import { createHash } from "crypto";

// AppImage runtime version and location
const RUNTIME_VERSION = "20251108";
const RUNTIME_URL = `https://github.com/AppImage/type2-runtime/releases/download/${RUNTIME_VERSION}/runtime-x86_64`;

// SHA256 hash of the expected runtime binary
// Can be generated with: curl -sL <URL> | sha256sum
// Also visible directly on the GitHub releases page; see 'runtime-x86_64' on:
// https://github.com/AppImage/type2-runtime/releases/tag/20251108
const RUNTIME_SHA256 =
  "2fca8b443c92510f1483a883f60061ad09b46b978b2631c807cd873a47ec260d";

// For creating temporary work directories; largely arbitrary
const APPDIR_PREFIX = "AppDir";
const WORKDIR_PREFIX = "AppImageWorkDir";

/**
 * Minimalist Forge maker for AppImages
 */
export class MakerAppImage extends MakerBase<{ icon?: string }> {
  override defaultPlatforms = ["linux"];
  override name = "AppImage";
  override requiredExternalBinaries = ["mksquashfs"];

  override isSupportedOnCurrentPlatform(): boolean {
    return process.platform === "linux" && process.arch === "x64";
  }

  override async make({
    appName,
    dir,
    makeDir,
    packageJSON,
  }: MakerOptions): Promise<string[]> {
    const version = packageJSON["version"];

    if (!version || typeof version !== "string")
      throw new Error("Could not access version information");

    const { icon } = this.config;

    const exeName = `${appName}_${version}_x86_64.AppImage`;
    const outputDir = resolve(makeDir, "AppImage");
    const outputFilePath = resolve(outputDir, exeName);

    // Fetch AppImage runtime
    const res = await fetch(RUNTIME_URL, {
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });

    if (!res.ok)
      throw new Error(
        `Could not fetch AppImage runtime: ${res.status} ${res.statusText}`,
      );

    const runtime = Buffer.from(await res.arrayBuffer());

    // Verify SHA256 hash
    const hash = createHash("sha256").update(runtime).digest("hex");

    if (hash !== RUNTIME_SHA256)
      throw new Error(
        [
          "AppImage runtime integrity check failed.",
          `Expected: ${RUNTIME_SHA256}`,
          `Got:      ${hash}`,
          "The runtime binary may have been tampered with or updated.",
          "If this was intentional, please update RUNTIME_SHA256 in makers/MakerAppImage.ts.",
        ].join("\n"),
      );

    // Names of temporary directories to clean up later
    let appDir: string | undefined;
    let workDir: string | undefined;

    try {
      // Create directory structure of AppDir.
      // For conventions, see: https://docs.appimage.org/reference/appdir.html#conventions
      appDir = await mkdtemp(
        resolve(tmpdir(), `${APPDIR_PREFIX}_${appName}_${version}_`),
      );
      const binDir = resolve(appDir, "usr/bin");
      const libDir = resolve(appDir, `usr/lib/${appName}`);

      await mkdir(binDir, { recursive: true, mode: 0o755 });
      await mkdir(libDir, { recursive: true, mode: 0o755 });

      // Add the actual application code to the AppDir
      await cp(dir, libDir, { recursive: true });

      // Generate .desktop file
      // See: https://docs.appimage.org/reference/desktop-integration.html#desktop-files
      // Also: https://specifications.freedesktop.org/desktop-entry/latest/recognized-keys.html
      const desktopFile = [
        "[Desktop Entry]",
        "Type=Application",
        "Version=1.5",
        `Name=${appName}`,
        ...(icon ? [`Icon=${appName}`] : []),
        "Exec=AppRun %U",
        `X-AppImage-Name=${appName}`,
        `X-AppImage-Version=${version}`,
        "X-AppImage-Arch=x86_64",
      ].join("\n");

      await writeFile(resolve(appDir, `${appName}.desktop`), desktopFile);

      // Add the icon
      if (icon) {
        const ext = extname(icon);

        if (!ext || ext !== ".png")
          throw new Error(`Invalid icon extension: ${ext || "[None]"}`);

        const finalIconName = `${appName}${ext}`;
        const finalIconPath = resolve(appDir, finalIconName);

        await copyFile(icon, finalIconPath);
        await symlink(finalIconName, resolve(appDir, ".DirIcon"), "file");
      }

      // By convention, executables should be in /bin
      await symlink(
        relative(binDir, resolve(libDir, appName)),
        resolve(binDir, appName),
        "file",
      );

      // The entry point of an AppImage should be the AppRun file.
      // See: https://docs.appimage.org/reference/appdir.html#general-description
      await symlink(
        relative(appDir, resolve(binDir, appName)),
        resolve(appDir, "AppRun"),
        "file",
      );

      // mksquashfs emits a file, so we create a temporary file
      // inside a temporary directory to hold the output
      workDir = await mkdtemp(
        resolve(tmpdir(), `${WORKDIR_PREFIX}_${appName}_${version}_`),
      );
      const tempSquashedFsPath = resolve(workDir, "temp");

      const execFileAsync = promisify(execFile);

      try {
        await execFileAsync("mksquashfs", [appDir, tempSquashedFsPath]);
      } catch (err: any) {
        const stderr = err?.stderr?.toString?.() ?? "";
        const stdout = err?.stdout?.toString?.() ?? "";

        throw new Error(
          [
            "mksquashfs failed",
            `exit code: ${err?.code ?? "unknown"}`,
            stderr && `stderr:\n${stderr}`,
            stdout && `stdout:\n${stdout}`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }

      // Directory to hold final executable
      await mkdir(outputDir, { recursive: true, mode: 0o755 });

      // Per the documentation, AppImages should consist
      // of the runtime prepended to the squashed fs.
      // See: https://docs.appimage.org/reference/architecture.html
      await writeFile(outputFilePath, runtime);
      await appendFile(outputFilePath, await readFile(tempSquashedFsPath));

      await chmod(outputFilePath, 0o755);

      return [outputFilePath];
    } finally {
      // Clean up temporary directories
      if (appDir)
        await rm(appDir, {
          recursive: true,
          force: true,
        });

      if (workDir)
        await rm(workDir, {
          recursive: true,
          force: true,
        });
    }
  }
}
