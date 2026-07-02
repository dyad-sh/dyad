import { dialog, ipcMain } from "electron";
import { platform, arch } from "os";
import fixPath from "fix-path";
import { runShellCommand } from "../utils/runShellCommand";
import { readRefreshedWindowsPath } from "../utils/windows_env_path";
import log from "electron-log";
import { existsSync } from "fs";
import fs from "fs/promises";
import { delimiter, join } from "path";
import { readSettings, writeSettings } from "../../main/settings";
import { createTypedHandler } from "./base";
import { systemContracts } from "../types/system";
import { IS_TEST_BUILD } from "../utils/test_utils";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { safeSend } from "@/ipc/utils/safe_sender";
import { getPathEnvKey } from "@/ipc/utils/path_env";
import {
  getManagedNodeBinDir,
  getManagedNodeBinDirsForInstalledVersions,
  getManagedNodeBinaryPath,
  getManagedNodeVersion,
  getNodeVersionAtPath,
  installManagedNode,
  cancelManagedNodeInstall,
  isManagedNodeInstalled,
  isManagedNodeSupported,
  isUsableSystemNodeVersion,
  ManagedNodeInstallError,
  MANAGED_NODE_VERSION,
  removeManagedNode,
  type NodeRuntimeSource,
} from "@/ipc/utils/managed_node";
import { sendTelemetryEvent } from "@/ipc/utils/telemetry";
import { prependPathSegment, sanitizePathEnv } from "@/ipc/utils/managed_tools";
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

async function reloadNodePath() {
  const pathKey = getPathEnvKey(process.env);
  if (platform() === "win32") {
    // Re-read PATH from the registry: spawning a child (e.g. `cmd /c echo
    // %PATH%`) can never observe PATH entries an installer added while Dyad
    // was running, because children inherit this process's stale copy.
    const refreshedPath = await readRefreshedWindowsPath(
      process.env.PATH ?? "",
    );
    if (refreshedPath) {
      process.env[pathKey] = refreshedPath;
    }
  } else {
    fixPath();
  }

  const settings = readSettings();
  const customNode = await getCustomNodeInfo(settings.customNodePath);
  let nextEnv = removePathSegmentsFromEnv(process.env, [
    ...getManagedNodeBinDirsForInstalledVersions(),
    settings.customNodePath,
  ]);

  if (customNode && settings.customNodePath) {
    nextEnv = prependPathSegment(nextEnv, settings.customNodePath);
    logger.debug("Added custom Node.js path to PATH:", settings.customNodePath);
  } else if (settings.customNodePath) {
    logger.warn(
      "Configured custom Node.js path is not usable; falling back to the selected runtime preference.",
      settings.customNodePath,
    );
  }

  if (!customNode && settings.nodeRuntimePreference === "managed") {
    nextEnv = prependPathSegment(nextEnv, getManagedNodeBinDir());
  } else if (!customNode) {
    // Intended behavior: "system" is an explicit system-only preference, not
    // system-first with a managed fallback. Managed is only added when the user
    // selects the Managed runtime.
    logger.debug("Using system Node.js preference.");
  }
  process.env[pathKey] = sanitizePathEnv(nextEnv)[pathKey] ?? "";
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

function getNodeBinaryFromBinDir(binDir: string): string {
  return join(binDir, platform() === "win32" ? "node.exe" : "node");
}

async function getSystemNodePath(
  env: NodeJS.ProcessEnv = sanitizePathEnv(process.env),
): Promise<string | null> {
  if (platform() === "win32") {
    const output = await runShellCommand("where node", {
      env,
    });
    return output?.split(/\r?\n/u)[0]?.trim() || null;
  }
  return runShellCommand("command -v node", {
    env,
  });
}

function normalizePathSegmentForComparison(segment: string): string {
  const normalizedSegment = segment.trim().replace(/^"|"$/g, "");
  if (platform() === "win32") {
    return normalizedSegment.toLowerCase();
  }
  return normalizedSegment;
}

function removePathSegmentsFromEnv(
  env: NodeJS.ProcessEnv,
  segmentsToRemove: Array<string | null | undefined>,
): NodeJS.ProcessEnv {
  const pathKey = getPathEnvKey(env);
  const currentPath = env[pathKey] ?? "";
  const normalizedSegmentsToRemove = segmentsToRemove
    .filter((segment): segment is string => !!segment)
    .map(normalizePathSegmentForComparison);

  if (normalizedSegmentsToRemove.length === 0 || !currentPath) {
    return sanitizePathEnv({ ...env });
  }

  const filteredPath = currentPath
    .split(delimiter)
    .filter((segment) => {
      const normalizedSegment = normalizePathSegmentForComparison(segment);
      return !normalizedSegmentsToRemove.includes(normalizedSegment);
    })
    .join(delimiter);

  return sanitizePathEnv({
    ...env,
    [pathKey]: filteredPath,
  });
}

function getSystemNodeProbeEnv(
  customNodePath?: string | null,
): NodeJS.ProcessEnv {
  return removePathSegmentsFromEnv(process.env, [
    ...getManagedNodeBinDirsForInstalledVersions(),
    customNodePath,
  ]);
}

async function getCustomNodeInfo(
  customNodePath?: string | null,
): Promise<{ nodePath: string; nodeVersion: string } | null> {
  if (!customNodePath) {
    return null;
  }
  const nodePath = getNodeBinaryFromBinDir(customNodePath);
  const nodeVersion = await getNodeVersionAtPath(nodePath);
  return nodeVersion ? { nodePath, nodeVersion } : null;
}

function emptyNodeStatus(nodeDownloadUrl: string) {
  return {
    nodeVersion: null,
    pnpmVersion: null,
    nodeDownloadUrl,
    source: null,
    nodePath: null,
    managedNodeInstalled: false,
    managedNodeVersion: null,
    systemNodeTooOld: false,
    managedNodeSupported: isManagedNodeSupported(),
  };
}

async function getResolvedNodeStatus(nodeDownloadUrl: string) {
  const settings = readSettings();
  const managedNodeVersion = await getManagedNodeVersion();
  const managedNodeInstalled = !!managedNodeVersion;
  const managedNodeSupported = isManagedNodeSupported();

  let nodeVersion: string | null = null;
  let source: NodeRuntimeSource | null = null;
  let nodePath: string | null = null;
  let systemNodeTooOld = false;

  const customNode = await getCustomNodeInfo(settings.customNodePath);
  if (customNode) {
    nodePath = customNode.nodePath;
    nodeVersion = customNode.nodeVersion;
    source = "custom";
  } else {
    if (settings.customNodePath) {
      logger.warn(
        "Configured custom Node.js path is not usable; ignoring it for status resolution.",
        settings.customNodePath,
      );
    }
    const systemEnv = getSystemNodeProbeEnv(settings.customNodePath);
    const systemNodeVersion = await runShellCommand("node --version", {
      env: systemEnv,
    });
    const systemNodePath = await getSystemNodePath(systemEnv);
    systemNodeTooOld =
      !!systemNodeVersion && !isUsableSystemNodeVersion(systemNodeVersion);

    // Intended behavior: when the user selects System, a managed runtime on
    // disk is not used as a fallback. Managed is only active when selected.
    if (
      settings.nodeRuntimePreference === "managed" &&
      managedNodeInstalled &&
      managedNodeVersion
    ) {
      source = "managed";
      nodeVersion = managedNodeVersion;
      nodePath = getManagedNodeBinaryPath();
    } else if (
      systemNodeVersion &&
      isUsableSystemNodeVersion(systemNodeVersion)
    ) {
      source = "system";
      nodeVersion = systemNodeVersion;
      nodePath = systemNodePath;
    } else {
      nodeVersion = null;
      nodePath = systemNodePath;
    }
  }

  const pnpmVersion = nodeVersion
    ? await getPnpmVersionAndScheduleInstall()
    : null;

  return {
    nodeVersion,
    pnpmVersion,
    nodeDownloadUrl,
    source,
    nodePath,
    managedNodeInstalled,
    managedNodeVersion,
    systemNodeTooOld,
    managedNodeSupported,
  };
}

async function getSelectedManagedNodeStatus(nodeDownloadUrl: string) {
  const settings = readSettings();
  if (settings.nodeRuntimePreference !== "managed") {
    return null;
  }

  const managedNodeVersion = await getManagedNodeVersion();
  if (!managedNodeVersion) {
    return null;
  }

  return {
    nodeVersion: managedNodeVersion,
    pnpmVersion: await getPnpmVersionAndScheduleInstall(),
    nodeDownloadUrl,
    source: "managed" as const,
    nodePath: getManagedNodeBinaryPath(),
    managedNodeInstalled: true,
    managedNodeVersion,
    systemNodeTooOld: false,
    managedNodeSupported: isManagedNodeSupported(),
  };
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
  let nodeDownloadUrl = `https://nodejs.org/dist/${MANAGED_NODE_VERSION}/node-${MANAGED_NODE_VERSION}.pkg`;
  if (platform() == "win32") {
    if (arch() === "arm64" || arch() === "arm") {
      nodeDownloadUrl = `https://nodejs.org/dist/${MANAGED_NODE_VERSION}/node-${MANAGED_NODE_VERSION}-arm64.msi`;
    } else {
      // x64 is the most common architecture for Windows so it's the
      // default download url.
      nodeDownloadUrl = `https://nodejs.org/dist/${MANAGED_NODE_VERSION}/node-${MANAGED_NODE_VERSION}-x64.msi`;
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
        const managedNodeStatus =
          await getSelectedManagedNodeStatus(nodeDownloadUrl);
        if (managedNodeStatus) {
          return managedNodeStatus;
        }
        return emptyNodeStatus(nodeDownloadUrl);
      }
      if (devNodejsStatus === "installed") {
        return {
          nodeVersion: MANAGED_NODE_VERSION,
          pnpmVersion: "9.0.0",
          nodeDownloadUrl,
          source: "system" as const,
          nodePath: "node",
          managedNodeInstalled: false,
          managedNodeVersion: null,
          systemNodeTooOld: false,
          managedNodeSupported: isManagedNodeSupported(),
        };
      }
    }

    // Test-only: Return mock state if set
    if (IS_TEST_BUILD && mockNodeInstalled !== null) {
      logger.log("Using mock Node.js status:", mockNodeInstalled);
      if (mockNodeInstalled) {
        return {
          nodeVersion: MANAGED_NODE_VERSION,
          pnpmVersion: "9.0.0",
          nodeDownloadUrl,
          source: "system" as const,
          nodePath: "node",
          managedNodeInstalled: false,
          managedNodeVersion: null,
          systemNodeTooOld: false,
          managedNodeSupported: isManagedNodeSupported(),
        };
      }
      const settings = readSettings();
      if (settings.nodeRuntimePreference === "managed") {
        const managedNodeInstalled = await isManagedNodeInstalled();
        const managedNodeVersion = managedNodeInstalled
          ? await getManagedNodeVersion()
          : null;
        if (managedNodeInstalled && managedNodeVersion) {
          return {
            nodeVersion: managedNodeVersion,
            pnpmVersion: process.env.DYAD_TEST_PNPM_VERSION ?? null,
            nodeDownloadUrl,
            source: "managed" as const,
            nodePath: getManagedNodeBinaryPath(),
            managedNodeInstalled,
            managedNodeVersion,
            systemNodeTooOld: false,
            managedNodeSupported: isManagedNodeSupported(),
          };
        }
      }
      return emptyNodeStatus(nodeDownloadUrl);
    }

    return getResolvedNodeStatus(nodeDownloadUrl);
  });

  createTypedHandler(systemContracts.installManagedNode, async (event) => {
    sendTelemetryEvent("managed_node_install", { status: "started" });
    try {
      const nodeVersion = await installManagedNode((progress) => {
        safeSend(event.sender, "managed-node:install-progress", progress);
      });
      const settings = readSettings();
      const customNode = await getCustomNodeInfo(settings.customNodePath);
      writeSettings({
        // Preserve a valid custom path; it remains the most explicit runtime
        // selection. If there is no valid custom runtime, the install button
        // switches Dyad to the newly installed managed runtime.
        nodeRuntimePreference: customNode
          ? (settings.nodeRuntimePreference ?? "system")
          : "managed",
      });
      await reloadNodePath();
      managedPnpmImplicitInstallFailed = false;
      sendTelemetryEvent("managed_node_install", {
        status: "succeeded",
        node_version: nodeVersion,
      });
      return { nodeVersion };
    } catch (error) {
      if (
        error instanceof DyadError &&
        error.kind === DyadErrorKind.UserCancelled
      ) {
        sendTelemetryEvent("managed_node_install", { status: "cancelled" });
        throw error;
      }
      sendTelemetryEvent("managed_node_install", {
        status: "failed",
        failure_category:
          error instanceof ManagedNodeInstallError ? error.category : "unknown",
      });
      throw error;
    }
  });

  createTypedHandler(systemContracts.cancelManagedNodeInstall, async () => {
    cancelManagedNodeInstall();
  });

  createTypedHandler(systemContracts.removeManagedNode, async () => {
    await removeManagedNode();
    writeSettings({
      nodeRuntimePreference: "system",
    });
    await reloadNodePath();
  });

  createTypedHandler(systemContracts.installPnpm, async () => {
    try {
      const testInstallPnpmVersion = IS_TEST_BUILD
        ? process.env.DYAD_TEST_INSTALL_PNPM_VERSION
        : undefined;
      if (testInstallPnpmVersion) {
        process.env.DYAD_TEST_PNPM_VERSION = testInstallPnpmVersion;
        await reloadNodePath();
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
    await reloadNodePath();
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

  createTypedHandler(systemContracts.getNodePath, async () => {
    const settings = readSettings();
    const customNode = await getCustomNodeInfo(settings.customNodePath);
    if (customNode) {
      return customNode.nodePath;
    }
    if (settings.nodeRuntimePreference === "managed") {
      const managedNodeVersion = await getManagedNodeVersion();
      return managedNodeVersion ? getManagedNodeBinaryPath() : null;
    }
    return getSystemNodePath(getSystemNodeProbeEnv(settings.customNodePath));
  });
}
