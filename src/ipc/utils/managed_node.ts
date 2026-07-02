import { net } from "electron";
import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import {
  clearSanitizedPathCache,
  getManagedToolsDir,
  prependPathSegment,
  sanitizePathEnv,
} from "@/ipc/utils/managed_tools";
import { getPathEnvKey } from "@/ipc/utils/path_env";
import { isVersionAtLeast } from "@/shared/version_utils";

const logger = log.scope("managed_node");

export const MANAGED_NODE_VERSION = "v24.18.0";
const EXPECTED_MANAGED_NODE_VERSION =
  IS_TEST_BUILD && process.env.DYAD_TEST_MANAGED_NODE_EXPECTED_VERSION
    ? process.env.DYAD_TEST_MANAGED_NODE_EXPECTED_VERSION
    : MANAGED_NODE_VERSION;
export const MINIMUM_SYSTEM_NODE_VERSION = "20.0.0";
export const MANAGED_NODE_INSTALL_CANCELLED_MESSAGE =
  "Managed Node.js install was cancelled.";
const MANAGED_NODE_DIR = "node";
const NODE_DIST_BASE_URL = `https://nodejs.org/dist/${MANAGED_NODE_VERSION}`;
const NODE_MIRROR_BASE_URL = `https://registry.npmmirror.com/-/binary/node/${MANAGED_NODE_VERSION}`;
const DOWNLOAD_STALL_TIMEOUT_MS = 60_000;

type SupportedManagedNodeKey =
  | "darwin-arm64"
  | "darwin-x64"
  | "win32-arm64"
  | "win32-x64";

type ManagedNodeArtifact = {
  fileName: string;
  sha256: string;
};

const MANAGED_NODE_ARTIFACTS: Record<
  SupportedManagedNodeKey,
  ManagedNodeArtifact
> = {
  "darwin-arm64": {
    fileName: "node-v24.18.0-darwin-arm64.tar.gz",
    sha256: "e1a97e14c99c803e96c7339403282ea05a499c32f8d83defe9ef5ec66f979ed1",
  },
  "darwin-x64": {
    fileName: "node-v24.18.0-darwin-x64.tar.gz",
    sha256: "dfd0dbd3e721503434df7b7205e719f61b3a3a31b2bcf9729b8b91fea240f080",
  },
  "win32-arm64": {
    fileName: "node-v24.18.0-win-arm64.zip",
    sha256: "f274669adb93b1fd0fbf8f21fd078609e9dcc84333d4f2718d2dde3f9a161a01",
  },
  "win32-x64": {
    fileName: "node-v24.18.0-win-x64.zip",
    sha256: "0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821",
  },
};

export type NodeRuntimeSource = "system" | "managed" | "custom";

export type ManagedNodeInstallProgress = {
  phase: "downloading" | "verifying" | "extracting" | "installing" | "done";
  percent: number;
};

export type ManagedNodeInstallFailureCategory =
  | "network"
  | "checksum"
  | "extract"
  | "av-blocked"
  | "disk"
  | "unsupported";

export class ManagedNodeInstallError extends DyadError {
  category: ManagedNodeInstallFailureCategory;

  constructor(message: string, category: ManagedNodeInstallFailureCategory) {
    super(message, DyadErrorKind.Precondition);
    this.name = "ManagedNodeInstallError";
    this.category = category;
  }
}

let managedNodeInstallPromise: Promise<string> | null = null;
let managedNodeInstallAbortController: AbortController | null = null;
const managedNodeInstallProgressListeners = new Set<
  (progress: ManagedNodeInstallProgress) => void
>();

function createManagedNodeInstallCancelledError(): DyadError {
  return new DyadError(
    MANAGED_NODE_INSTALL_CANCELLED_MESSAGE,
    DyadErrorKind.UserCancelled,
  );
}

function isManagedNodeInstallCancelledError(error: unknown): boolean {
  return (
    error instanceof DyadError && error.kind === DyadErrorKind.UserCancelled
  );
}

function throwIfManagedNodeInstallCancelled(signal: AbortSignal): void {
  if (signal.aborted) {
    throw createManagedNodeInstallCancelledError();
  }
}

function getManagedNodeRootDir(): string {
  return path.join(getManagedToolsDir(), MANAGED_NODE_DIR);
}

export function getManagedNodeInstallDir(
  version = MANAGED_NODE_VERSION,
): string {
  return path.join(getManagedNodeRootDir(), version);
}

function getManagedNodeBinDirForInstallDir(installDir: string): string {
  return process.platform === "win32"
    ? installDir
    : path.join(installDir, "bin");
}

function getManagedNodeBinaryPathForInstallDir(installDir: string): string {
  return path.join(
    getManagedNodeBinDirForInstallDir(installDir),
    process.platform === "win32" ? "node.exe" : "node",
  );
}

function isManagedNodeVersionDirName(name: string): boolean {
  return /^v\d+\.\d+\.\d+(?:-.+)?$/.test(name);
}

function compareManagedNodeVersionNames(a: string, b: string): number {
  const aAtLeastB = isVersionAtLeast(a, b);
  const bAtLeastA = isVersionAtLeast(b, a);
  if (aAtLeastB && !bAtLeastA) {
    return 1;
  }
  if (bAtLeastA && !aAtLeastB) {
    return -1;
  }
  return a.localeCompare(b, undefined, { numeric: true });
}

function getManagedNodeVersionInstallDirsSync({
  requireBinary,
}: {
  requireBinary: boolean;
}): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(getManagedNodeRootDir(), { withFileTypes: true });
  } catch {
    return [];
  }

  return entries
    .filter(
      (entry) => entry.isDirectory() && isManagedNodeVersionDirName(entry.name),
    )
    .map((entry) => path.join(getManagedNodeRootDir(), entry.name))
    .filter(
      (installDir) =>
        !requireBinary ||
        fs.existsSync(getManagedNodeBinaryPathForInstallDir(installDir)),
    )
    .sort((a, b) =>
      compareManagedNodeVersionNames(path.basename(a), path.basename(b)),
    );
}

function getActiveManagedNodeInstallDirSync(): string {
  const pinnedInstallDir = getManagedNodeInstallDir(MANAGED_NODE_VERSION);
  if (fs.existsSync(getManagedNodeBinaryPathForInstallDir(pinnedInstallDir))) {
    return pinnedInstallDir;
  }

  return (
    getManagedNodeVersionInstallDirsSync({ requireBinary: true }).at(-1) ??
    pinnedInstallDir
  );
}

export function getManagedNodeBinDir(): string {
  return getManagedNodeBinDirForInstallDir(
    getActiveManagedNodeInstallDirSync(),
  );
}

export function getManagedNodeBinDirsForInstalledVersions(): string[] {
  const binDirs = [
    getManagedNodeBinDirForInstallDir(getManagedNodeInstallDir()),
    ...getManagedNodeVersionInstallDirsSync({ requireBinary: false }).map(
      getManagedNodeBinDirForInstallDir,
    ),
  ];
  return Array.from(new Set(binDirs));
}

export function getManagedNodeBinaryPath(
  installDir = getActiveManagedNodeInstallDirSync(),
) {
  return getManagedNodeBinaryPathForInstallDir(installDir);
}

export function getManagedNodeNpmCommand(): string {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

export function withManagedNodePath(
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  return prependPathSegment(sanitizePathEnv(env), getManagedNodeBinDir());
}

export function applyManagedNodeToProcessPath(): void {
  const pathKey = getPathEnvKey(process.env);
  const nextEnv = withManagedNodePath(process.env);
  process.env[pathKey] = nextEnv[pathKey] ?? "";
}

export function isManagedNodeSupported(): boolean {
  return getManagedNodeArtifact() !== null;
}

function getManagedNodeArtifact(): ManagedNodeArtifact | null {
  const testArchiveUrl = IS_TEST_BUILD
    ? process.env.DYAD_TEST_MANAGED_NODE_ARCHIVE_URL
    : undefined;
  if (testArchiveUrl) {
    let fileName = "dyad-test-managed-node.tar.gz";
    try {
      const parsedUrl = new URL(testArchiveUrl);
      fileName = path.basename(parsedUrl.pathname) || fileName;
    } catch {
      fileName = path.basename(testArchiveUrl) || fileName;
    }
    return {
      fileName,
      sha256: process.env.DYAD_TEST_MANAGED_NODE_SHA256 ?? "",
    };
  }

  if (process.platform === "darwin" || process.platform === "win32") {
    const normalizedArch = os.arch() === "arm64" ? "arm64" : "x64";
    const key =
      `${process.platform}-${normalizedArch}` as SupportedManagedNodeKey;
    return MANAGED_NODE_ARTIFACTS[key] ?? null;
  }

  return null;
}

export async function isManagedNodeInstalled(
  version = MANAGED_NODE_VERSION,
): Promise<boolean> {
  try {
    await fsp.access(
      getManagedNodeBinaryPathForInstallDir(getManagedNodeInstallDir(version)),
    );
    return true;
  } catch {
    return false;
  }
}

export function isUsableSystemNodeVersion(version: string | null): boolean {
  return !!version && isVersionAtLeast(version, MINIMUM_SYSTEM_NODE_VERSION);
}

export function getNodeVersionAtPath(nodePath: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn(nodePath, ["--version"], {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    child.stdout?.on("data", (data) => {
      stdout += data.toString();
    });
    child.once("error", () => resolve(null));
    child.once("close", (code) => {
      const version = stdout.trim();
      resolve(code === 0 && version ? version : null);
    });
  });
}

export async function getManagedNodeVersion(
  version?: string,
): Promise<string | null> {
  const installDir = version
    ? getManagedNodeInstallDir(version)
    : getActiveManagedNodeInstallDirSync();
  return getNodeVersionAtPath(
    getManagedNodeBinaryPathForInstallDir(installDir),
  );
}

async function calculateSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

function runProcess(
  command: string,
  args: string[],
  options: { cwd?: string; signal?: AbortSignal } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(createManagedNodeInstallCancelledError());
      return;
    }

    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    let settled = false;

    function cleanupAbortListener() {
      options.signal?.removeEventListener("abort", handleAbort);
    }

    function resolveOnce() {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      resolve();
    }

    function rejectOnce(error: Error) {
      if (settled) return;
      settled = true;
      cleanupAbortListener();
      reject(error);
    }

    let abortRequested = false;

    function handleAbort() {
      // Reject from the "close" handler instead of here so callers only see
      // the cancellation after the child has released its file handles;
      // rejecting immediately lets cleanup race the dying process.
      abortRequested = true;
      child.kill();
    }

    options.signal?.addEventListener("abort", handleAbort, { once: true });
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.once("error", rejectOnce);
    child.once("close", (code) => {
      if (abortRequested) {
        rejectOnce(createManagedNodeInstallCancelledError());
      } else if (code === 0) {
        resolveOnce();
      } else {
        rejectOnce(
          new Error(stderr.trim() || `${command} exited with code ${code}`),
        );
      }
    });
  });
}

async function downloadFile({
  url,
  destination,
  onProgress,
  signal,
}: {
  url: string;
  destination: string;
  onProgress: (progress: ManagedNodeInstallProgress) => void;
  signal: AbortSignal;
}): Promise<void> {
  throwIfManagedNodeInstallCancelled(signal);
  if (url.startsWith("file://")) {
    await fsp.copyFile(new URL(url), destination);
    throwIfManagedNodeInstallCancelled(signal);
    onProgress({ phase: "downloading", percent: 100 });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = net.request(url);
    let output: fs.WriteStream | null = null;
    let settled = false;
    let responseEnded = false;
    let outputFinished = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const clearDownloadTimeout = () => {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
    };

    function cleanupAbortListener() {
      signal.removeEventListener("abort", handleAbort);
    }

    function resolveOnce() {
      if (settled) {
        return;
      }
      settled = true;
      clearDownloadTimeout();
      cleanupAbortListener();
      resolve();
    }

    function handleError(error: Error) {
      if (settled) {
        return;
      }
      settled = true;
      clearDownloadTimeout();
      cleanupAbortListener();
      output?.destroy();
      try {
        request.abort();
      } catch {
        // Best effort only; the promise is already settled with the real error.
      }
      reject(error);
    }

    function handleAbort() {
      handleError(createManagedNodeInstallCancelledError());
    }

    const resetDownloadTimeout = () => {
      clearDownloadTimeout();
      timeout = setTimeout(() => {
        handleError(
          new Error(
            `Download stalled for ${Math.round(DOWNLOAD_STALL_TIMEOUT_MS / 1000)} seconds.`,
          ),
        );
      }, DOWNLOAD_STALL_TIMEOUT_MS);
    };

    signal.addEventListener("abort", handleAbort, { once: true });
    resetDownloadTimeout();

    request.on("response", (response) => {
      resetDownloadTimeout();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        handleError(new Error(`Download returned HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = Number(response.headers["content-length"] ?? 0);
      let receivedBytes = 0;
      output = fs.createWriteStream(destination);
      response.on("data", (chunk: Buffer) => {
        if (settled) {
          return;
        }
        resetDownloadTimeout();
        receivedBytes += chunk.length;
        output?.write(chunk);
        if (totalBytes > 0) {
          onProgress({
            phase: "downloading",
            percent: Math.min(
              95,
              Math.round((receivedBytes / totalBytes) * 95),
            ),
          });
        }
      });
      response.on("end", () => {
        responseEnded = true;
        resetDownloadTimeout();
        output?.end();
      });
      response.on("aborted", () => {
        handleError(new Error("Download was aborted before it completed."));
      });
      (response as unknown as EventEmitter).once("close", () => {
        if (!responseEnded && !settled) {
          handleError(
            new Error("Download connection closed before completion."),
          );
        }
      });
      response.on("error", handleError);
      output.on("finish", () => {
        outputFinished = true;
        output?.close((error) => {
          if (error) {
            handleError(error);
            return;
          }
          resolveOnce();
        });
      });
      output.on("close", () => {
        if (!outputFinished && !settled) {
          handleError(new Error("Download file closed before completion."));
        }
      });
      output.on("error", handleError);
    });
    request.on("abort", () => {
      handleError(new Error("Download request was aborted."));
    });
    request.on("error", handleError);
    request.end();
  });
  throwIfManagedNodeInstallCancelled(signal);
}

async function extractArchive({
  archivePath,
  extractDir,
  signal,
}: {
  archivePath: string;
  extractDir: string;
  signal: AbortSignal;
}): Promise<void> {
  throwIfManagedNodeInstallCancelled(signal);
  await fsp.mkdir(extractDir, { recursive: true });
  if (process.platform === "win32") {
    await runProcess(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& { Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force }",
        archivePath,
        extractDir,
      ],
      { signal },
    );
    return;
  }
  await runProcess("tar", ["-xzf", archivePath, "-C", extractDir], {
    signal,
  });
  throwIfManagedNodeInstallCancelled(signal);
}

async function findExtractedNodeRoot(extractDir: string): Promise<string> {
  const entries = await fsp.readdir(extractDir, { withFileTypes: true });
  const directories = entries.filter((entry) => entry.isDirectory());
  if (directories.length === 1) {
    return path.join(extractDir, directories[0].name);
  }
  return extractDir;
}

async function installFromArchive({
  archivePath,
  expectedSha256,
  onProgress,
  signal,
}: {
  archivePath: string;
  expectedSha256: string;
  onProgress: (progress: ManagedNodeInstallProgress) => void;
  signal: AbortSignal;
}): Promise<string> {
  throwIfManagedNodeInstallCancelled(signal);
  onProgress({ phase: "verifying", percent: 96 });
  const actualSha256 = await calculateSha256(archivePath);
  throwIfManagedNodeInstallCancelled(signal);
  if (actualSha256 !== expectedSha256) {
    throw new ManagedNodeInstallError(
      "Downloaded Node.js did not match the expected checksum.",
      "checksum",
    );
  }

  const rootDir = getManagedNodeRootDir();
  const tempExtractDir = path.join(rootDir, "tmp", `extract-${Date.now()}`);
  const tempInstallDir = path.join(
    rootDir,
    `.${MANAGED_NODE_VERSION}-${Date.now()}`,
  );
  const finalInstallDir = getManagedNodeInstallDir();

  try {
    onProgress({ phase: "extracting", percent: 97 });
    await extractArchive({ archivePath, extractDir: tempExtractDir, signal });
    throwIfManagedNodeInstallCancelled(signal);
    const extractedRoot = await findExtractedNodeRoot(tempExtractDir);
    throwIfManagedNodeInstallCancelled(signal);
    await fsp.rename(extractedRoot, tempInstallDir);
    throwIfManagedNodeInstallCancelled(signal);

    const verifiedVersion = await getManagedNodeVersionFromDir(tempInstallDir);
    throwIfManagedNodeInstallCancelled(signal);
    if (verifiedVersion !== EXPECTED_MANAGED_NODE_VERSION) {
      throw new ManagedNodeInstallError(
        `Installed Node.js reported ${verifiedVersion ?? "no version"} instead of ${EXPECTED_MANAGED_NODE_VERSION}. Your antivirus may have blocked the executable.`,
        "av-blocked",
      );
    }

    onProgress({ phase: "installing", percent: 99 });
    // The swap is the point of no return: the new runtime now lives at the
    // final install dir, so a late cancel must not report the install as
    // cancelled or skip the activation steps below.
    await swapManagedNodeInstallDir({ tempInstallDir, finalInstallDir });
    await cleanupOldManagedNodeVersions();
    clearSanitizedPathCache();
    applyManagedNodeToProcessPath();
    onProgress({ phase: "done", percent: 100 });
    return verifiedVersion;
  } catch (error) {
    await fsp.rm(tempInstallDir, { recursive: true, force: true });
    if (isManagedNodeInstallCancelledError(error)) {
      throw error;
    }
    if (error instanceof ManagedNodeInstallError) {
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    throw new ManagedNodeInstallError(
      `Could not extract managed Node.js: ${message}`,
      message.toLowerCase().includes("space") ? "disk" : "extract",
    );
  } finally {
    await fsp.rm(tempExtractDir, { recursive: true, force: true });
  }
}

type ManagedNodeInstallDirSwapOptions = {
  tempInstallDir: string;
  finalInstallDir: string;
  backupInstallDir?: string;
  rename?: typeof fsp.rename;
  rm?: typeof fsp.rm;
};

function isMissingPathError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function swapManagedNodeInstallDir({
  tempInstallDir,
  finalInstallDir,
  backupInstallDir = path.join(
    path.dirname(finalInstallDir),
    `.${path.basename(finalInstallDir)}-backup-${Date.now()}`,
  ),
  rename = fsp.rename,
  rm = fsp.rm,
}: ManagedNodeInstallDirSwapOptions): Promise<void> {
  let movedExistingInstall = false;
  let promotedNewInstall = false;

  await rm(backupInstallDir, { recursive: true, force: true });

  try {
    try {
      await rename(finalInstallDir, backupInstallDir);
      movedExistingInstall = true;
    } catch (error) {
      if (!isMissingPathError(error)) {
        throw error;
      }
    }

    await rename(tempInstallDir, finalInstallDir);
    promotedNewInstall = true;

    if (movedExistingInstall) {
      await rm(backupInstallDir, { recursive: true, force: true }).catch(
        (cleanupError) => {
          logger.warn(
            "Failed to remove previous managed Node.js backup:",
            cleanupError,
          );
        },
      );
    }
  } catch (error) {
    if (movedExistingInstall && !promotedNewInstall) {
      try {
        await rm(finalInstallDir, { recursive: true, force: true });
        await rename(backupInstallDir, finalInstallDir);
      } catch (rollbackError) {
        logger.error(
          "Failed to restore previous managed Node.js installation:",
          rollbackError,
        );
      }
    }
    throw error;
  }
}

async function getManagedNodeVersionFromDir(
  installDir: string,
): Promise<string | null> {
  return getNodeVersionAtPath(getManagedNodeBinaryPath(installDir));
}

async function cleanupOldManagedNodeVersions(): Promise<void> {
  const rootDir = getManagedNodeRootDir();
  const entries = await fsp
    .readdir(rootDir, { withFileTypes: true })
    .catch(() => []);
  await Promise.all(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          entry.name.startsWith("v") &&
          entry.name !== MANAGED_NODE_VERSION,
      )
      .map((entry) =>
        fsp
          .rm(path.join(rootDir, entry.name), {
            recursive: true,
            force: true,
          })
          .catch((error) => {
            logger.warn(
              `Failed to clean up old managed Node.js version ${entry.name}:`,
              error,
            );
          }),
      ),
  );
}

function getDownloadCandidates(artifact: ManagedNodeArtifact): string[] {
  const testArchiveUrl = IS_TEST_BUILD
    ? process.env.DYAD_TEST_MANAGED_NODE_ARCHIVE_URL
    : undefined;
  if (testArchiveUrl) {
    return [testArchiveUrl];
  }
  return [
    `${NODE_DIST_BASE_URL}/${artifact.fileName}`,
    `${NODE_MIRROR_BASE_URL}/${artifact.fileName}`,
  ];
}

function getExpectedSha256(artifact: ManagedNodeArtifact): string {
  return IS_TEST_BUILD && process.env.DYAD_TEST_MANAGED_NODE_SHA256
    ? process.env.DYAD_TEST_MANAGED_NODE_SHA256
    : artifact.sha256;
}

export function installManagedNode(
  onProgress: (progress: ManagedNodeInstallProgress) => void,
): Promise<string> {
  if (
    managedNodeInstallPromise &&
    managedNodeInstallAbortController?.signal.aborted
  ) {
    // A cancelled install is still winding down. Joining it would reject with
    // UserCancelled and make this request a silent no-op, so wait for it to
    // settle and start fresh.
    return managedNodeInstallPromise
      .catch(() => {})
      .then(() => installManagedNode(onProgress));
  }

  managedNodeInstallProgressListeners.add(onProgress);
  if (managedNodeInstallPromise) {
    return managedNodeInstallPromise.finally(() => {
      managedNodeInstallProgressListeners.delete(onProgress);
    });
  }

  managedNodeInstallAbortController = new AbortController();
  const signal = managedNodeInstallAbortController.signal;
  managedNodeInstallPromise = installManagedNodeInternal(signal, (progress) => {
    for (const listener of managedNodeInstallProgressListeners) {
      try {
        listener(progress);
      } catch (error) {
        logger.warn("Managed Node.js progress listener failed:", error);
      }
    }
  }).finally(() => {
    managedNodeInstallPromise = null;
    managedNodeInstallAbortController = null;
    managedNodeInstallProgressListeners.clear();
  });

  return managedNodeInstallPromise.finally(() => {
    managedNodeInstallProgressListeners.delete(onProgress);
  });
}

export function cancelManagedNodeInstall(): void {
  managedNodeInstallAbortController?.abort();
}

async function removeArchiveBestEffort(archivePath: string): Promise<void> {
  try {
    await fsp.rm(archivePath, { force: true });
  } catch (error) {
    logger.warn("Failed to remove managed Node.js archive:", error);
  }
}

async function installArchiveAndCleanUp({
  archivePath,
  expectedSha256,
  onProgress,
  signal,
}: {
  archivePath: string;
  expectedSha256: string;
  onProgress: (progress: ManagedNodeInstallProgress) => void;
  signal: AbortSignal;
}): Promise<string> {
  const nodeVersion = await installFromArchive({
    archivePath,
    expectedSha256,
    onProgress,
    signal,
  });
  await removeArchiveBestEffort(archivePath);
  return nodeVersion;
}

async function installManagedNodeInternal(
  signal: AbortSignal,
  onProgress: (progress: ManagedNodeInstallProgress) => void,
): Promise<string> {
  throwIfManagedNodeInstallCancelled(signal);
  const artifact = getManagedNodeArtifact();
  if (!artifact) {
    throw new ManagedNodeInstallError(
      "Dyad-managed Node.js is currently available on Windows and macOS.",
      "unsupported",
    );
  }

  const rootDir = getManagedNodeRootDir();
  const tmpDir = path.join(rootDir, "tmp");
  await fsp.mkdir(tmpDir, { recursive: true });
  throwIfManagedNodeInstallCancelled(signal);
  const archivePath = path.join(tmpDir, artifact.fileName);
  const expectedSha256 = getExpectedSha256(artifact);

  let lastError: unknown;
  for (const candidateUrl of getDownloadCandidates(artifact)) {
    try {
      throwIfManagedNodeInstallCancelled(signal);
      await fsp.rm(archivePath, { force: true });
      onProgress({ phase: "downloading", percent: 0 });
      await downloadFile({
        url: candidateUrl,
        destination: archivePath,
        onProgress,
        signal,
      });
      return await installArchiveAndCleanUp({
        archivePath,
        expectedSha256,
        onProgress,
        signal,
      });
    } catch (error) {
      if (isManagedNodeInstallCancelledError(error)) {
        throw error;
      }
      lastError = error;
      logger.warn("Managed Node.js install candidate failed:", {
        candidateUrl,
        error,
      });
      if (
        IS_TEST_BUILD ||
        (error instanceof ManagedNodeInstallError &&
          error.category !== "checksum")
      ) {
        break;
      }
    }
  }

  if (lastError instanceof ManagedNodeInstallError) {
    throw lastError;
  }
  if (isManagedNodeInstallCancelledError(lastError)) {
    throw lastError;
  }
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new ManagedNodeInstallError(
    `Could not download managed Node.js: ${message}`,
    "network",
  );
}

export async function removeManagedNode(): Promise<void> {
  await fsp.rm(getManagedNodeRootDir(), { recursive: true, force: true });
  clearSanitizedPathCache();
}

export async function maybeUpgradeManagedNode(): Promise<void> {
  const installed = await isManagedNodeInstalled(MANAGED_NODE_VERSION);
  if (!installed) {
    const rootDir = getManagedNodeRootDir();
    const entries = await fsp
      .readdir(rootDir, { withFileTypes: true })
      .catch(() => []);
    const hasOldVersion = entries.some(
      (entry) => entry.isDirectory() && entry.name.startsWith("v"),
    );
    if (hasOldVersion) {
      void installManagedNode(() => {}).catch((error) => {
        logger.warn("Failed to upgrade managed Node.js in background:", error);
      });
    }
  }
}
