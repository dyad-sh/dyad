import { net } from "electron";
import { createHash } from "node:crypto";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { IS_TEST_BUILD } from "@/ipc/utils/test_utils";
import {
  getManagedToolsDir,
  prependPathSegment,
  sanitizePathEnv,
} from "@/ipc/utils/managed_tools";
import { getPathEnvKey } from "@/ipc/utils/path_env";
import { isVersionAtLeast } from "@/shared/version_utils";

const logger = log.scope("managed_node");

export const MANAGED_NODE_VERSION = "v22.22.3";
export const MINIMUM_SYSTEM_NODE_VERSION = "20.0.0";
const MANAGED_NODE_DIR = "node";
const NODE_DIST_BASE_URL = `https://nodejs.org/dist/${MANAGED_NODE_VERSION}`;
const NODE_MIRROR_BASE_URL = `https://registry.npmmirror.com/-/binary/node/${MANAGED_NODE_VERSION}`;

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
    fileName: "node-v22.22.3-darwin-arm64.tar.gz",
    sha256: "0da7ff74ef8611328c8212f17943368713a2ad953fb7d89a8c8a0eae87c23207",
  },
  "darwin-x64": {
    fileName: "node-v22.22.3-darwin-x64.tar.gz",
    sha256: "45830ba752fa0d892c6dcd640946669801293cac820a33591ded40ac075198ec",
  },
  "win32-arm64": {
    fileName: "node-v22.22.3-win-arm64.zip",
    sha256: "00be129a09e8872cd52d3bb8bba12412c5733d2224123a482a2dca4a6fbf2586",
  },
  "win32-x64": {
    fileName: "node-v22.22.3-win-x64.zip",
    sha256: "6c8d54f635feff4df76c2ca80f45332eb2ff57d25226edce36592e51a177ee33",
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

export function getManagedNodeBinDir(): string {
  return getManagedNodeBinDirForInstallDir(getManagedNodeInstallDir());
}

export function getManagedNodeBinaryPath(
  installDir = getManagedNodeInstallDir(),
) {
  return path.join(
    getManagedNodeBinDirForInstallDir(installDir),
    process.platform === "win32" ? "node.exe" : "node",
  );
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
  if (process.platform !== "darwin" && process.platform !== "win32") {
    return null;
  }
  const normalizedArch = os.arch() === "arm64" ? "arm64" : "x64";
  const key =
    `${process.platform}-${normalizedArch}` as SupportedManagedNodeKey;
  return MANAGED_NODE_ARTIFACTS[key] ?? null;
}

export async function isManagedNodeInstalled(
  version = MANAGED_NODE_VERSION,
): Promise<boolean> {
  try {
    await fsp.access(
      getManagedNodeBinaryPath(getManagedNodeInstallDir(version)),
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
  version = MANAGED_NODE_VERSION,
): Promise<string | null> {
  const installDir = getManagedNodeInstallDir(version);
  return getNodeVersionAtPath(getManagedNodeBinaryPath(installDir));
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
  options: { cwd?: string } = {},
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (data) => {
      stderr += data.toString();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(
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
}: {
  url: string;
  destination: string;
  onProgress: (progress: ManagedNodeInstallProgress) => void;
}): Promise<void> {
  if (url.startsWith("file://")) {
    await fsp.copyFile(new URL(url), destination);
    onProgress({ phase: "downloading", percent: 100 });
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const request = net.request(url);
    request.on("response", (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        reject(new Error(`Download returned HTTP ${response.statusCode}`));
        return;
      }

      const totalBytes = Number(response.headers["content-length"] ?? 0);
      let receivedBytes = 0;
      const output = fs.createWriteStream(destination);
      response.on("data", (chunk: Buffer) => {
        receivedBytes += chunk.length;
        output.write(chunk);
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
        output.end();
      });
      output.on("finish", () => {
        output.close(() => resolve());
      });
      output.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function extractArchive({
  archivePath,
  extractDir,
}: {
  archivePath: string;
  extractDir: string;
}): Promise<void> {
  await fsp.mkdir(extractDir, { recursive: true });
  if (process.platform === "win32") {
    await runProcess("powershell.exe", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archivePath,
      extractDir,
    ]);
    return;
  }
  await runProcess("tar", ["-xzf", archivePath, "-C", extractDir]);
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
}: {
  archivePath: string;
  expectedSha256: string;
  onProgress: (progress: ManagedNodeInstallProgress) => void;
}): Promise<string> {
  onProgress({ phase: "verifying", percent: 96 });
  const actualSha256 = await calculateSha256(archivePath);
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
    await extractArchive({ archivePath, extractDir: tempExtractDir });
    const extractedRoot = await findExtractedNodeRoot(tempExtractDir);
    await fsp.rename(extractedRoot, tempInstallDir);

    const verifiedVersion = await getManagedNodeVersionFromDir(tempInstallDir);
    if (verifiedVersion !== MANAGED_NODE_VERSION) {
      throw new ManagedNodeInstallError(
        `Installed Node.js reported ${verifiedVersion ?? "no version"} instead of ${MANAGED_NODE_VERSION}. Your antivirus may have blocked the executable.`,
        "av-blocked",
      );
    }

    onProgress({ phase: "installing", percent: 99 });
    await fsp.rm(finalInstallDir, { recursive: true, force: true });
    await fsp.rename(tempInstallDir, finalInstallDir);
    await cleanupOldManagedNodeVersions();
    applyManagedNodeToProcessPath();
    onProgress({ phase: "done", percent: 100 });
    return verifiedVersion;
  } catch (error) {
    await fsp.rm(tempInstallDir, { recursive: true, force: true });
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
        fsp.rm(path.join(rootDir, entry.name), {
          recursive: true,
          force: true,
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
  if (managedNodeInstallPromise) {
    return managedNodeInstallPromise;
  }

  managedNodeInstallPromise = installManagedNodeInternal(onProgress).finally(
    () => {
      managedNodeInstallPromise = null;
    },
  );
  return managedNodeInstallPromise;
}

async function installManagedNodeInternal(
  onProgress: (progress: ManagedNodeInstallProgress) => void,
): Promise<string> {
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
  const archivePath = path.join(tmpDir, artifact.fileName);
  const expectedSha256 = getExpectedSha256(artifact);

  let lastError: unknown;
  for (const candidateUrl of getDownloadCandidates(artifact)) {
    try {
      await fsp.rm(archivePath, { force: true });
      onProgress({ phase: "downloading", percent: 0 });
      await downloadFile({
        url: candidateUrl,
        destination: archivePath,
        onProgress,
      });
      return await installFromArchive({
        archivePath,
        expectedSha256,
        onProgress,
      });
    } catch (error) {
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
  const message =
    lastError instanceof Error ? lastError.message : String(lastError);
  throw new ManagedNodeInstallError(
    `Could not download managed Node.js: ${message}`,
    "network",
  );
}

export async function removeManagedNode(): Promise<void> {
  await fsp.rm(getManagedNodeRootDir(), { recursive: true, force: true });
}

export async function maybeUpgradeManagedNode(): Promise<void> {
  const installed = await isManagedNodeInstalled();
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
