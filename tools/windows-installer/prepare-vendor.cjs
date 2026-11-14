const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// Same source revision as electron-winstaller 5.4.0's Squirrel 2.0.1 binaries.
const revision = "eef37460aef77b2f9de8cd2237c1e55b344a6554";
const squirrelVendorDirectory = path.resolve(
  __dirname,
  "../../.cache/squirrel-vendor",
);

function patchSetup(source) {
  // Normalize Git/platform line endings before matching the pinned upstream code.
  source = source.replace(/\r\n/g, "\n");
  const anchor =
    "\texitCode = CUpdateRunner::ExtractUpdaterAndRun(lpCmdLine, false);";
  if (
    source.includes("DyadInstallGuard") ||
    source.split(anchor).length !== 2 ||
    !source.includes('#include "MachineInstaller.h"')
  ) {
    throw new Error(
      "Unexpected Squirrel Setup source; refusing to build an unguarded installer",
    );
  }
  return source
    .replace(
      '#include "MachineInstaller.h"',
      '#include "MachineInstaller.h"\n#include "DyadInstallGuard.h"',
    )
    .replace(
      anchor,
      `\t// Keep the guard alive through extraction, Update.exe, and cleanup.
\t{
\t\tdyad::InstallGuard installGuard;
\t\tstd::wstring guardError;
\t\twchar_t localAppData[MAX_PATH] = {};
\t\tif (FAILED(SHGetFolderPathW(NULL, CSIDL_LOCAL_APPDATA, NULL, SHGFP_TYPE_CURRENT, localAppData))) {
\t\t\tguardError = L"Setup could not locate your Dyad installation. Please try again.";
\t\t\texitCode = ERROR_INSTALL_FAILURE;
\t\t} else {
\t\t\texitCode = installGuard.Acquire(std::wstring(localAppData) + L"\\\\dyad", guardError);
\t\t}
\t\tif (exitCode != ERROR_SUCCESS) {
\t\t\tif (!isQuiet) CUpdateRunner::DisplayErrorMessage(CString(guardError.c_str()), NULL);
\t\t\tgoto out;
\t\t}
\t\texitCode = CUpdateRunner::ExtractUpdaterAndRun(lpCmdLine, false);
\t}`,
    );
}

async function prepareSquirrelVendor() {
  if (process.platform !== "win32") {
    throw new Error(
      "Building the guarded Windows installer requires Windows and Visual Studio C++ build tools",
    );
  }
  if (require("electron-winstaller/package.json").version !== "5.4.0") {
    throw new Error(
      "Revalidate the guarded Squirrel build before upgrading electron-winstaller",
    );
  }
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "dyad-squirrel-"));
  try {
    const source = path.join(temporary, "source");
    const git = (args, capture = false) =>
      execFileSync("git.exe", args, {
        stdio: capture ? "pipe" : "inherit",
        encoding: "utf8",
        timeout: 120_000,
      });
    // Pin Git's source-content identity instead of generated archive bytes.
    git(["init", "--quiet", source]);
    git([
      "-C",
      source,
      "remote",
      "add",
      "origin",
      "https://github.com/Squirrel/Squirrel.Windows.git",
    ]);
    git(["-C", source, "fetch", "--depth=1", "origin", revision]);
    git(["-C", source, "checkout", "--detach", "FETCH_HEAD"]);
    if (git(["-C", source, "rev-parse", "HEAD"], true).trim() !== revision) {
      throw new Error("Unexpected Squirrel source revision");
    }
    const setup = path.join(source, "src/Setup");
    const entry = path.join(setup, "winmain.cpp");
    fs.writeFileSync(entry, patchSetup(fs.readFileSync(entry, "utf8")));
    fs.copyFileSync(
      path.join(__dirname, "DyadInstallGuard.h"),
      path.join(setup, "DyadInstallGuard.h"),
    );

    const stockVendor = path.join(
      path.dirname(require.resolve("electron-winstaller/package.json")),
      "vendor",
    );
    fs.mkdirSync(squirrelVendorDirectory, { recursive: true });
    fs.cpSync(stockVendor, squirrelVendorDirectory, { recursive: true });
    // CI installs JS dependencies without lifecycle scripts. Materialize the
    // host's 7-Zip tools just as electron-winstaller's install script would.
    for (const extension of ["exe", "dll"]) {
      fs.copyFileSync(
        path.join(stockVendor, `7z-${os.arch()}.${extension}`),
        path.join(squirrelVendorDirectory, `7z.${extension}`),
      );
    }
    // Never leave a stock Setup.exe behind if the guarded build fails.
    fs.rmSync(path.join(squirrelVendorDirectory, "Setup.exe"));
    execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(__dirname, "build-setup.ps1"),
        "-SourceDirectory",
        source,
        "-OutputDirectory",
        squirrelVendorDirectory,
      ],
      { stdio: "inherit" },
    );
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

module.exports = { patchSetup, prepareSquirrelVendor, squirrelVendorDirectory };

if (require.main === module) {
  prepareSquirrelVendor().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
