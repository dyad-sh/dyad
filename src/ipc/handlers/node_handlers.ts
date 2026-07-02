import { dialog, ipcMain } from "electron";
import { execSync } from "child_process";
import { platform, arch } from "os";
import fixPath from "fix-path";
import { runShellCommand } from "../utils/runShellCommand";
import log from "electron-log";
import { existsSync } from "fs";
import fs from "fs/promises";
import { join } from "path";
import { readSettings } from "../../main/settings";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  applyManagedPnpmToProcessPath,
  getCommandExecutionDisplayDetails,
  getManagedPnpmCliScriptPath,
  getManagedPnpmInstallDir,
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  PNPM_GLOBAL_INSTALL_PACKAGE,
  PNPM_MINIMUM_RELEASE_AGE_VERSION,
  runCommand,
} from "@/ipc/utils/socket_firewall";

const logger = log.scope("node_handlers");
const BRAILLE_SPINNER_PATTERN = /^[\u2800-\u28ff]+$/u;
let managedPnpmInstallPromise: Promise<string> | null = null;
let managedPnpmImplicitInstallFailed = false;

function reloadNodePath() {
  if (platform() === "win32") {
    const newPath = execSync("cmd /c echo %PATH%", {
      encoding: "utf8",
    }).trim();
    process.env.PATH = newPath;
  } else {
    fixPath();
  }

  const settings = readSettings();
  if (settings.customNodePath) {
    const separator = platform() === "win32" ? ";" : ":";
    process.env.PATH = `${settings.customNodePath}${separator}${process.env.PATH}`;
    logger.debug("Added custom Node.js path to PATH:", settings.customNodePath);
  }
  applyManagedPnpmToProcessPath();
}

function formatInstallFailureReason(error: unknown): string {
  const details = getCommandExecutionDisplayDetails(error);
  const message = error instanceof Error ? error.message : String(error);
  const detailLines = (details ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line && !BRAILLE_SPINNER_PATTERN.test(line) && /[a-z0-9]/iu.test(line),
    );
  const reason = (detailLines.at(-1) || message).trim();

  if (!reason) {
    return "the install command failed";
  }

  return reason;
}

async function installManagedPnpm(): Promise<string> {
  const managedPnpmInstallDir = getManagedPnpmInstallDir();
  await fs.mkdir(managedPnpmInstallDir, { recursive: true });
  // Pin npm's project-root discovery to the managed dir: without a
  // package.json here, npm walks up from cwd and would install into an
  // ancestor that happens to contain a package.json (e.g. a stray one in
  // the user's home directory).
  const managedPackageJsonPath = join(managedPnpmInstallDir, "package.json");
  if (!existsSync(managedPackageJsonPath)) {
    await fs.writeFile(
      managedPackageJsonPath,
      `${JSON.stringify({ name: "dyad-managed-pnpm", private: true }, null, 2)}\n`,
    );
  }
  // Install via cwd instead of a --prefix argument: on Windows, absolute
  // paths with spaces (e.g. C:\Users\John Doe) in the argv of a .cmd
  // invocation get mangled by the cmd.exe quoting that node-pty applies,
  // while cwd goes straight to the pty API without shell parsing. A local
  // install into cwd lands in the same node_modules layout --prefix produced.
  await runCommand(
    "npm",
    [
      "install",
      "--force",
      // A user-level .npmrc with bin-links=false would otherwise skip
      // creating node_modules/.bin/pnpm, which the managed PATH entry
      // depends on.
      "--bin-links=true",
      PNPM_GLOBAL_INSTALL_PACKAGE,
    ],
    {
      cwd: managedPnpmInstallDir,
      env: getPackageManagerCommandEnv(),
    },
  );
  applyManagedPnpmToProcessPath();

  // Verify via `node pnpm.cjs` rather than the pnpm.cmd shim: node is a real
  // executable, so the space-containing script path survives Windows argument
  // quoting that breaks for cmd.exe batch invocations.
  const result = await runCommand("node", [
    getManagedPnpmCliScriptPath(),
    "--version",
  ]);
  const pnpmVersion = result.stdout.trim();
  if (!pnpmVersion) {
    throw new Error("pnpm installed, but its version could not be verified");
  }

  return pnpmVersion;
}

function getManagedPnpmInstallPromise(): Promise<string> {
  if (!managedPnpmInstallPromise) {
    managedPnpmInstallPromise = installManagedPnpm().finally(() => {
      managedPnpmInstallPromise = null;
    });
  }
  return managedPnpmInstallPromise;
}

function scheduleManagedPnpmInstall(currentPnpmVersion: string | null): void {
  if (managedPnpmInstallPromise) {
    logger.info("Dyad-managed pnpm install is already in progress.");
    return;
  }
  if (managedPnpmImplicitInstallFailed) {
    logger.info(
      "Skipping implicit Dyad-managed pnpm install because it already failed this session.",
    );
    return;
  }

  if (currentPnpmVersion) {
    logger.info(
      `Existing pnpm ${currentPnpmVersion} is older than ${PNPM_MINIMUM_RELEASE_AGE_VERSION}; installing Dyad-managed pnpm in the background.`,
    );
  } else {
    logger.info(
      "pnpm not found; installing Dyad-managed pnpm in the background.",
    );
  }

  void getManagedPnpmInstallPromise()
    .then((managedPnpmVersion) => {
      managedPnpmImplicitInstallFailed = false;
      logger.info(`Installed Dyad-managed pnpm ${managedPnpmVersion}.`);
    })
    .catch((error) => {
      managedPnpmImplicitInstallFailed = true;
      logger.warn("Failed to implicitly install managed pnpm:", error);
    });
}

async function getPnpmVersionAndScheduleInstall(): Promise<string | null> {
  const pnpmSupport = await getPnpmMinimumReleaseAgeSupport();
  const currentPnpmVersion = pnpmSupport.version ?? null;
  if (pnpmSupport.available && pnpmSupport.minimumReleaseAgeSupported) {
    logger.info(
      `Using existing pnpm ${currentPnpmVersion}; no managed install needed.`,
    );
    return currentPnpmVersion;
  }

  scheduleManagedPnpmInstall(currentPnpmVersion);
  return currentPnpmVersion;
}

// Test-only: Mock state for Node.js installation status
// null = use real check, true = mock as installed, false = mock as not installed
let mockNodeInstalled: boolean | null = null;

function getNodeDownloadUrl(): string {
  // In E2E test mode, return a placeholder URL to avoid actual Node.js downloads.
  // This URL is never actually fetched since open-external-url is also skipped in test mode.
  if (IS_TEST_BUILD) {
    return "https://example.com/fake-node-installer.pkg";
  }

  // Default to mac download url.
  let nodeDownloadUrl = "https://nodejs.org/dist/v22.22.3/node-v22.22.3.pkg";
  if (platform() == "win32") {
    if (arch() === "arm64" || arch() === "arm") {
      nodeDownloadUrl =
        "https://nodejs.org/dist/v22.22.3/node-v22.22.3-arm64.msi";
    } else {
      // x64 is the most common architecture for Windows so it's the
      // default download url.
      nodeDownloadUrl =
        "https://nodejs.org/dist/v22.22.3/node-v22.22.3-x64.msi";
    }
  }
  return nodeDownloadUrl;
}

export function registerNodeHandlers() {
  // Test-only handler to control Node.js mock state
  // Guarded by IS_TEST_BUILD constant
  if (IS_TEST_BUILD) {
    ipcMain.handle(
      "test:set-node-mock",
      async (_, { installed }: { installed: boolean | null }) => {
        logger.log("test:set-node-mock called with installed:", installed);
        mockNodeInstalled = installed;
      },
    );
  }

  createTypedHandler(systemContracts.getNodejsStatus, async () => {
    logger.log(
      "handling ipc: nodejs-status for platform:",
      platform(),
      "and arch:",
      arch(),
    );

    const nodeDownloadUrl = getNodeDownloadUrl();
    const devNodejsStatus = process.env.DYAD_DEV_NODEJS_STATUS;

    if (process.env.NODE_ENV === "development" && devNodejsStatus) {
      logger.log("Using dev Node.js status override:", devNodejsStatus);
      if (devNodejsStatus === "missing") {
        return { nodeVersion: null, pnpmVersion: null, nodeDownloadUrl };
      }
      if (devNodejsStatus === "installed") {
        return {
          nodeVersion: "v22.22.3",
          pnpmVersion: "9.0.0",
          nodeDownloadUrl,
        };
      }
    }

    // Test-only: Return mock state if set
    if (IS_TEST_BUILD && mockNodeInstalled !== null) {
      logger.log("Using mock Node.js status:", mockNodeInstalled);
      if (mockNodeInstalled) {
        return {
          nodeVersion: "v22.22.3",
          pnpmVersion: "9.0.0",
          nodeDownloadUrl,
        };
      }
      return { nodeVersion: null, pnpmVersion: null, nodeDownloadUrl };
    }

    // Run checks in parallel
    const [nodeVersion, pnpmVersion] = await Promise.all([
      runShellCommand("node --version"),
      getPnpmVersionAndScheduleInstall(),
    ]);
    return { nodeVersion, pnpmVersion, nodeDownloadUrl };
  });

  createTypedHandler(systemContracts.installPnpm, async () => {
    try {
      const testInstallPnpmVersion = IS_TEST_BUILD
        ? process.env.DYAD_TEST_INSTALL_PNPM_VERSION
        : undefined;
      if (testInstallPnpmVersion) {
        process.env.DYAD_TEST_PNPM_VERSION = testInstallPnpmVersion;
        reloadNodePath();
        return { pnpmVersion: testInstallPnpmVersion };
      }

      const pnpmVersion = await getManagedPnpmInstallPromise();
      managedPnpmImplicitInstallFailed = false;
      return { pnpmVersion };
    } catch (error) {
      logger.error("Failed to install pnpm:", error);
      const details = getCommandExecutionDisplayDetails(error);
      if (details) {
        logger.error("pnpm install command output:", details);
      }

      const reason = formatInstallFailureReason(error);
      throw new DyadError(
        `Could not install pnpm because of ${reason}`,
        DyadErrorKind.Precondition,
      );
    }
  });

  createTypedHandler(systemContracts.reloadEnvPath, async () => {
    logger.debug("Reloading env path, previously:", process.env.PATH);
    reloadNodePath();
    logger.debug("Reloaded env path, now:", process.env.PATH);
  });

  createTypedHandler(systemContracts.selectNodeFolder, async () => {
    const result = await dialog.showOpenDialog({
      title: "Select Node.js Installation Folder",
      properties: ["openDirectory"],
      message: "Select the folder where Node.js is installed",
    });

    if (result.canceled) {
      return { path: null, canceled: true, selectedPath: null };
    }

    if (!result.filePaths[0]) {
      return { path: null, canceled: false, selectedPath: null };
    }

    const selectedPath = result.filePaths[0];

    // Verify Node.js exists in selected path
    const nodeBinary = platform() === "win32" ? "node.exe" : "node";
    const nodePath = join(selectedPath, nodeBinary);

    if (!existsSync(nodePath)) {
      // Check bin subdirectory (common on Unix systems)
      const binPath = join(selectedPath, "bin", nodeBinary);
      if (existsSync(binPath)) {
        return {
          path: join(selectedPath, "bin"),
          canceled: false,
          selectedPath,
        };
      }
      return { path: null, canceled: false, selectedPath };
    }
    return { path: selectedPath, canceled: false, selectedPath };
  });
}
