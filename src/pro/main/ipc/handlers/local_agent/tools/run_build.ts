import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log/main";
import { glob } from "glob";
import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";
import {
  detectFrameworkType,
  detectNextJsMajorVersion,
} from "@/ipc/utils/framework_utils";
import { choosePackageManagerForApp } from "@/ipc/utils/package_manager_selection";
import { runningApps } from "@/ipc/utils/process_manager";
import { runBufferedProcess } from "@/ipc/utils/buffered_process";
import { getGitProcessEnvironment } from "@/ipc/utils/git_utils";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
  PNPM_INSTALL_POLICY_ARGS,
} from "@/ipc/utils/socket_firewall";
import type { AppFrameworkType } from "@/lib/framework_constants";
import { getUserDataPath } from "@/paths/paths";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";

const runBuildSchema = z.object({});

const MAX_BUILD_RUNS_PER_TURN = 3;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_OUTPUT_CHARS = 16_000;
const BUILD_OUTPUT_PREVIEW_INTERVAL_MS = 250;
const WINDOWS_SNAPSHOT_COPY_CONCURRENCY = 32;
const STALE_SNAPSHOT_AGE_MS = 60 * 60_000;
const SNAPSHOT_PREFIX = ".dyad-build-";
const SNAPSHOT_NAME_PATTERN = /^\.dyad-build-[A-Za-z0-9]{6}$/;
const SNAPSHOT_MARKER_SUFFIX = ".owner.json";
const SNAPSHOT_MARKER_SCHEMA = "dyad-build-worktree-v1";
const SNAPSHOT_ROOT_NAME = "build-snapshots";
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const SNAPSHOT_EXCLUDED_NAMES = new Set([
  "node_modules",
  ".next",
  ".output",
  ".turbo",
  ".vite",
  "coverage",
  "dist",
  "out",
]);

const logger = log.scope("run_build");

export type BuildExecutionMode = "in-place" | "isolated";

export interface BuildProjectFacts {
  frameworkType: AppFrameworkType | null;
  buildScript: string;
  nextMajorVersion: number | null;
  previewRunning: boolean;
  previewInDocker: boolean;
  nextDevOutputIsolated: boolean;
  hasBuildLifecycleHooks: boolean;
}

/** OS-independent decision: platform only affects how an isolated copy is made. */
export function selectBuildExecutionMode(
  facts: BuildProjectFacts,
): BuildExecutionMode {
  if (!facts.previewRunning) {
    return "in-place";
  }

  if (facts.hasBuildLifecycleHooks) {
    return "isolated";
  }

  if (facts.previewInDocker) {
    return "isolated";
  }

  if (facts.frameworkType === "vite" && facts.buildScript === "vite build") {
    return "in-place";
  }

  if (
    facts.frameworkType === "nextjs" &&
    facts.buildScript === "next build" &&
    (facts.nextMajorVersion ?? 0) >= 16 &&
    facts.nextDevOutputIsolated
  ) {
    return "in-place";
  }

  return "isolated";
}

interface PackageJson {
  scripts?: Record<string, unknown>;
}

interface BuildAttemptState {
  count: number;
  mutationCountAtLastRun?: number;
  mutationCountAtLastSetupFailure?: number;
}

export interface Snapshot {
  path: string;
  worktreePath: string;
  setupMs: number;
  strategy: "git-worktree-overlay";
  sourceAppPath: string;
  sourceRepoPath: string;
}

interface SnapshotMarker {
  schema: typeof SNAPSHOT_MARKER_SCHEMA;
  sourceRepoPath: string;
  submoduleWorktrees: SubmoduleWorktree[];
}

interface SubmoduleWorktree {
  sourceRepoPath: string;
  snapshotPath: string;
}

const activeBuilds = new Set<number>();

function completeStatus(
  ctx: AgentContext,
  title: string,
  body: string,
  state: "finished" | "warning" = "finished",
): void {
  ctx.onXmlComplete(
    `<dyad-status title="${escapeXmlAttr(title)}" state="${state}">\n${escapeXmlContent(body)}\n</dyad-status>`,
  );
}

async function readPackageJson(appPath: string): Promise<PackageJson> {
  try {
    return JSON.parse(
      await fs.readFile(path.join(appPath, "package.json"), "utf8"),
    ) as PackageJson;
  } catch (error) {
    throw new DyadError(
      `Could not read package.json: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.Precondition,
    );
  }
}

function getScript(packageJson: PackageJson, name: string): string | null {
  const value = packageJson.scripts?.[name];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function gatherBuildProjectFacts(
  ctx: AgentContext,
  buildScript: string,
  hasBuildLifecycleHooks = false,
): Promise<BuildProjectFacts> {
  const runningApp = runningApps.get(ctx.appId);
  const previewRunning = runningApp !== undefined;
  return {
    frameworkType: detectFrameworkType(ctx.appPath),
    buildScript,
    nextMajorVersion: detectNextJsMajorVersion(ctx.appPath),
    previewRunning,
    previewInDocker: runningApp?.mode === "docker",
    hasBuildLifecycleHooks,
    nextDevOutputIsolated:
      !previewRunning ||
      (await fs
        .stat(path.join(ctx.appPath, ".next", "dev"))
        .then((stat) => stat.isDirectory())
        .catch(() => false)),
  };
}

function throwIfBuildCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
  }
}

async function runSnapshotGit(
  cwd: string,
  args: string[],
  signal?: AbortSignal,
  allowedExitCodes: readonly number[] = [0],
) {
  const { env, gitLocation } = getGitProcessEnvironment();
  const result = await runBufferedProcess({
    command: gitLocation,
    args,
    cwd,
    env,
    signal,
    maxOutputBytes: MAX_GIT_OUTPUT_BYTES,
  });
  if (result.aborted) {
    throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
  }
  if (result.timedOut) {
    throw new Error(`Git command timed out: git ${args.join(" ")}`);
  }
  if (result.stdoutTruncated || result.stderrTruncated) {
    throw new Error(
      `Git command output exceeded the snapshot limit: git ${args.join(" ")}`,
    );
  }
  if (!allowedExitCodes.includes(result.code ?? -1)) {
    throw new Error(
      result.stderr.trim() ||
        result.stdout.trim() ||
        `Git command failed: git ${args.join(" ")}`,
    );
  }
  return result;
}

function normalizeSnapshotRelativePath(
  rawPath: string,
  appRelativePath: string,
): string | null {
  const withoutTrailingSlash = rawPath.replace(/\/$/, "");
  const normalized = path.posix.normalize(withoutTrailingSlash);
  if (
    !normalized ||
    normalized === "." ||
    path.posix.isAbsolute(normalized) ||
    normalized === ".." ||
    normalized.startsWith("../")
  ) {
    return null;
  }
  return isExcludedSnapshotRelativePath(normalized, appRelativePath)
    ? null
    : normalized;
}

function isExcludedSnapshotRelativePath(
  normalized: string,
  appRelativePath: string,
): boolean {
  const segments = normalized.split("/");
  if (segments.includes(".git") || segments.includes("node_modules")) {
    return true;
  }
  const normalizedAppPath = appRelativePath
    ? path.posix.normalize(appRelativePath)
    : "";
  const pathWithinApp = normalizedAppPath
    ? normalized === normalizedAppPath
      ? ""
      : normalized.startsWith(`${normalizedAppPath}/`)
        ? normalized.slice(normalizedAppPath.length + 1)
        : null
    : normalized;
  const appRootSegment = pathWithinApp?.split("/", 1)[0];
  return Boolean(appRootSegment && SNAPSHOT_EXCLUDED_NAMES.has(appRootSegment));
}

export function parseWorkspaceOverlayPaths(
  statusOutput: string,
  appRelativePath = "",
): string[] {
  const fields = statusOutput.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4) continue;
    const status = field.slice(0, 2);
    const currentPath = normalizeSnapshotRelativePath(
      field.slice(3),
      appRelativePath,
    );
    if (currentPath) paths.add(currentPath);
    if (status.includes("R") || status.includes("C")) {
      const previousPath = normalizeSnapshotRelativePath(
        fields[index + 1] ?? "",
        appRelativePath,
      );
      if (previousPath) paths.add(previousPath);
      index += 1;
    }
  }

  const sorted = [...paths].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  );
  return sorted.filter(
    (candidate, index) =>
      !sorted
        .slice(0, index)
        .some((parent) => candidate.startsWith(`${parent}/`)),
  );
}

function toNativeSnapshotPath(relativePath: string): string {
  return path.join(...relativePath.split("/"));
}

async function overlayWorkspacePath(
  sourceRoot: string,
  realSourceRoot: string,
  snapshotRoot: string,
  relativePath: string,
  appRelativePath: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfBuildCancelled(signal);
  const nativeRelativePath = toNativeSnapshotPath(relativePath);
  const sourcePath = path.join(sourceRoot, nativeRelativePath);
  const destinationPath = path.join(snapshotRoot, nativeRelativePath);
  await fs.rm(destinationPath, { recursive: true, force: true });
  const sourceStat = await fs.lstat(sourcePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!sourceStat) return;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  if (process.platform === "win32") {
    await copySnapshotEntriesOnWindows(
      sourceRoot,
      realSourceRoot,
      snapshotRoot,
      [sourcePath],
      signal,
      appRelativePath,
    );
    return;
  }
  await fs.cp(sourcePath, destinationPath, {
    recursive: true,
    verbatimSymlinks: true,
    mode: fsConstants.COPYFILE_FICLONE,
    filter: (candidatePath) => {
      if (signal?.aborted) return false;
      const candidateRelativePath = path
        .relative(sourceRoot, candidatePath)
        .split(path.sep)
        .join("/");
      return !isExcludedSnapshotRelativePath(
        candidateRelativePath,
        appRelativePath,
      );
    },
  });
  throwIfBuildCancelled(signal);
}

async function overlayWorkspaceState(
  sourceRoot: string,
  snapshotRoot: string,
  appRelativePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const status = await runSnapshotGit(
    sourceRoot,
    [
      "-c",
      "core.fsmonitor=false",
      "status",
      "--porcelain=v1",
      "-z",
      "--untracked-files=normal",
      "--ignored=matching",
    ],
    signal,
  );
  const overlayPaths = parseWorkspaceOverlayPaths(
    status.stdout,
    appRelativePath,
  );
  const realSourceRoot = await fs.realpath(sourceRoot);
  for (
    let index = 0;
    index < overlayPaths.length;
    index += WINDOWS_SNAPSHOT_COPY_CONCURRENCY
  ) {
    await Promise.all(
      overlayPaths
        .slice(index, index + WINDOWS_SNAPSHOT_COPY_CONCURRENCY)
        .map((relativePath) =>
          overlayWorkspacePath(
            sourceRoot,
            realSourceRoot,
            snapshotRoot,
            relativePath,
            appRelativePath,
            signal,
          ),
        ),
    );
  }
}

export async function copySnapshotEntriesOnWindows(
  sourceRoot: string,
  realSourceRoot: string,
  snapshotRoot: string,
  initialPaths: string[],
  signal?: AbortSignal,
  appRelativePath?: string,
): Promise<void> {
  const pendingPaths = [...initialPaths];
  while (pendingPaths.length > 0) {
    throwIfBuildCancelled(signal);
    const batch = pendingPaths.splice(0, WINDOWS_SNAPSHOT_COPY_CONCURRENCY);
    const discoveredPaths = await Promise.all(
      batch.map((sourcePath) =>
        copySnapshotEntryOnWindows(
          sourceRoot,
          realSourceRoot,
          snapshotRoot,
          sourcePath,
          signal,
          appRelativePath,
        ),
      ),
    );
    pendingPaths.push(...discoveredPaths.flat());
  }
}

async function copySnapshotEntryOnWindows(
  sourceRoot: string,
  realSourceRoot: string,
  snapshotRoot: string,
  sourcePath: string,
  signal?: AbortSignal,
  appRelativePath?: string,
): Promise<string[]> {
  throwIfBuildCancelled(signal);
  const sourceRelativePath = path
    .relative(sourceRoot, sourcePath)
    .split(path.sep)
    .join("/");
  if (
    appRelativePath !== undefined &&
    isExcludedSnapshotRelativePath(sourceRelativePath, appRelativePath)
  ) {
    return [];
  }
  const destinationPath = path.join(
    snapshotRoot,
    path.relative(sourceRoot, sourcePath),
  );
  const stat = await fs.lstat(sourcePath);
  if (stat.isSymbolicLink()) {
    let realTarget: string;
    try {
      realTarget = await fs.realpath(sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (!pathIsInside(realSourceRoot, realTarget)) {
      throw externalSnapshotLinkError(path.relative(sourceRoot, sourcePath));
    }
    const targetStat = await fs.stat(realTarget);
    const mappedTarget = path.join(
      snapshotRoot,
      path.relative(realSourceRoot, realTarget),
    );
    if (!targetStat.isDirectory()) {
      await fs.copyFile(realTarget, destinationPath);
      return [];
    }
    await fs.symlink(mappedTarget, destinationPath, "junction");
    return [];
  }
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const children = await fs.readdir(sourcePath);
    return children.map((child) => path.join(sourcePath, child));
  }
  await fs.copyFile(sourcePath, destinationPath);
  return [];
}

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function externalSnapshotLinkError(relativePath: string): DyadError {
  return new DyadError(
    `Cannot isolate the linked path ${relativePath} because it points outside the Git repository. Replace the external link with a repository-local dependency before running a production build.`,
    DyadErrorKind.Precondition,
  );
}

interface SnapshotEntryInfo {
  entryPath: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

async function inspectSnapshotEntries(
  directory: string,
): Promise<SnapshotEntryInfo[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (process.platform !== "win32") {
    return entries.map((entry) => ({
      entryPath: path.join(directory, entry.name),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  }

  const inspected: SnapshotEntryInfo[] = [];
  for (
    let index = 0;
    index < entries.length;
    index += WINDOWS_SNAPSHOT_COPY_CONCURRENCY
  ) {
    const batch = entries.slice(
      index,
      index + WINDOWS_SNAPSHOT_COPY_CONCURRENCY,
    );
    inspected.push(
      ...(await Promise.all(
        batch.map(async (entry) => {
          const entryPath = path.join(directory, entry.name);
          const stat = await fs.lstat(entryPath);
          return {
            entryPath,
            isDirectory: stat.isDirectory(),
            isSymbolicLink: stat.isSymbolicLink(),
          };
        }),
      )),
    );
  }
  return inspected;
}

export async function secureSnapshotSymlinks(
  sourceRoot: string,
  snapshotRoot: string,
  signal?: AbortSignal,
): Promise<void> {
  const [realSourceRoot, realSnapshotRoot] = await Promise.all([
    fs.realpath(sourceRoot),
    fs.realpath(snapshotRoot),
  ]);
  const pendingDirectories = [snapshotRoot];
  while (pendingDirectories.length > 0) {
    throwIfBuildCancelled(signal);
    const directory = pendingDirectories.pop();
    if (!directory) break;
    const entries = await inspectSnapshotEntries(directory);
    for (const entry of entries) {
      if (!entry.isSymbolicLink) {
        if (entry.isDirectory) pendingDirectories.push(entry.entryPath);
        continue;
      }

      let realTarget: string;
      try {
        realTarget = await fs.realpath(entry.entryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await fs.unlink(entry.entryPath);
          continue;
        }
        throw new DyadError(
          `Cannot isolate the linked path ${path.relative(snapshotRoot, entry.entryPath)} because its target is unavailable.`,
          DyadErrorKind.Precondition,
        );
      }
      if (pathIsInside(realSnapshotRoot, realTarget)) continue;
      if (!pathIsInside(realSourceRoot, realTarget)) {
        throw externalSnapshotLinkError(
          path.relative(snapshotRoot, entry.entryPath),
        );
      }

      const mappedTarget = path.join(
        realSnapshotRoot,
        path.relative(realSourceRoot, realTarget),
      );
      const realEntryPath = path.join(
        realSnapshotRoot,
        path.relative(snapshotRoot, entry.entryPath),
      );
      const targetStat = await fs.stat(realTarget);
      await fs.rm(entry.entryPath, {
        force: true,
        recursive: targetStat.isDirectory(),
      });
      const linkTarget =
        process.platform === "win32" && targetStat.isDirectory()
          ? mappedTarget
          : path.relative(path.dirname(realEntryPath), mappedTarget) || ".";
      await fs.symlink(
        linkTarget,
        entry.entryPath,
        targetStat.isDirectory()
          ? process.platform === "win32"
            ? "junction"
            : "dir"
          : "file",
      );
    }
  }
}

function getBuildSnapshotRoot(): string {
  return path.join(getUserDataPath(), SNAPSHOT_ROOT_NAME);
}

function getSnapshotMarkerPath(snapshotPath: string): string {
  return `${snapshotPath}${SNAPSHOT_MARKER_SUFFIX}`;
}

async function writeSnapshotMarker(
  snapshotPath: string,
  sourceRepoPath: string,
  submoduleWorktrees: SubmoduleWorktree[] = [],
): Promise<void> {
  const marker: SnapshotMarker = {
    schema: SNAPSHOT_MARKER_SCHEMA,
    sourceRepoPath,
    submoduleWorktrees,
  };
  await fs.writeFile(
    getSnapshotMarkerPath(snapshotPath),
    JSON.stringify(marker),
    "utf8",
  );
}

async function readSnapshotMarker(
  snapshotPath: string,
): Promise<SnapshotMarker | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(getSnapshotMarkerPath(snapshotPath), "utf8"),
    ) as Partial<SnapshotMarker>;
    if (
      parsed.schema !== SNAPSHOT_MARKER_SCHEMA ||
      typeof parsed.sourceRepoPath !== "string" ||
      !path.isAbsolute(parsed.sourceRepoPath)
    ) {
      return null;
    }
    const submoduleWorktrees = Array.isArray(parsed.submoduleWorktrees)
      ? parsed.submoduleWorktrees.filter(
          (worktree): worktree is SubmoduleWorktree =>
            typeof worktree === "object" &&
            worktree !== null &&
            typeof worktree.sourceRepoPath === "string" &&
            path.isAbsolute(worktree.sourceRepoPath) &&
            typeof worktree.snapshotPath === "string" &&
            path.isAbsolute(worktree.snapshotPath) &&
            pathIsInside(snapshotPath, worktree.snapshotPath),
        )
      : [];
    return {
      schema: SNAPSHOT_MARKER_SCHEMA,
      sourceRepoPath: parsed.sourceRepoPath,
      submoduleWorktrees,
    };
  } catch {
    return null;
  }
}

async function removeExcludedSnapshotRoots(
  sourceRepoPath: string,
  snapshotPath: string,
  appRelativePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const excludedPaths = [...SNAPSHOT_EXCLUDED_NAMES].map((entry) =>
    appRelativePath ? path.posix.join(appRelativePath, entry) : entry,
  );
  const tracked = await runSnapshotGit(
    sourceRepoPath,
    ["ls-files", "-z", "--", ...excludedPaths],
    signal,
  );
  const trackedPaths = tracked.stdout.split("\0").filter(Boolean);
  await Promise.all(
    [...SNAPSHOT_EXCLUDED_NAMES].map((entry, index) => {
      const excludedPath = excludedPaths[index];
      if (
        trackedPaths.some(
          (trackedPath) =>
            trackedPath === excludedPath ||
            trackedPath.startsWith(`${excludedPath}/`),
        )
      ) {
        return Promise.resolve();
      }
      return fs.rm(path.join(snapshotPath, entry), {
        recursive: true,
        force: true,
      });
    }),
  );
}

async function materializeInitializedSubmodules(
  sourceRepoPath: string,
  snapshotRepoPath: string,
  ownerSnapshotPath: string,
  ownerSourceRepoPath: string,
  emptyHooksPath: string,
  registeredWorktrees: SubmoduleWorktree[],
  appRelativePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const gitmodulesPath = path.join(sourceRepoPath, ".gitmodules");
  const hasGitmodules = await fs
    .stat(gitmodulesPath)
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!hasGitmodules) return;

  const config = await runSnapshotGit(
    sourceRepoPath,
    [
      "config",
      "-z",
      "--file",
      gitmodulesPath,
      "--get-regexp",
      "^submodule\\..*\\.path$",
    ],
    signal,
    [0, 1],
  );
  for (const entry of config.stdout.split("\0")) {
    const separatorIndex = entry.indexOf("\n");
    if (separatorIndex < 0) continue;
    const relativePath = normalizeSnapshotRelativePath(
      entry.slice(separatorIndex + 1),
      appRelativePath,
    );
    if (!relativePath) continue;
    const sourceSubmodulePath = path.join(
      sourceRepoPath,
      toNativeSnapshotPath(relativePath),
    );
    const initialized = await fs
      .lstat(path.join(sourceSubmodulePath, ".git"))
      .then(() => true)
      .catch(() => false);
    if (!initialized) continue;

    const snapshotSubmodulePath = path.join(
      snapshotRepoPath,
      toNativeSnapshotPath(relativePath),
    );
    const childAppRelativePath = !appRelativePath
      ? ""
      : relativePath === appRelativePath
        ? ""
        : relativePath.startsWith(`${appRelativePath}/`)
          ? ""
          : appRelativePath.startsWith(`${relativePath}/`)
            ? appRelativePath.slice(relativePath.length + 1)
            : "__outside_target_app__";
    registeredWorktrees.push({
      sourceRepoPath: sourceSubmodulePath,
      snapshotPath: snapshotSubmodulePath,
    });
    await writeSnapshotMarker(
      ownerSnapshotPath,
      ownerSourceRepoPath,
      registeredWorktrees,
    );
    await fs.rm(snapshotSubmodulePath, { recursive: true, force: true });
    await runSnapshotGit(
      sourceSubmodulePath,
      [
        "-c",
        `core.hooksPath=${emptyHooksPath}`,
        "worktree",
        "add",
        "--detach",
        snapshotSubmodulePath,
        "HEAD",
      ],
      signal,
    );
    await overlayWorkspaceState(
      sourceSubmodulePath,
      snapshotSubmodulePath,
      childAppRelativePath,
      signal,
    );
    await materializeInitializedSubmodules(
      sourceSubmodulePath,
      snapshotSubmodulePath,
      ownerSnapshotPath,
      ownerSourceRepoPath,
      emptyHooksPath,
      registeredWorktrees,
      childAppRelativePath,
      signal,
    );
  }
}

export async function createBuildWorktree(
  appPath: string,
  snapshotRoot: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const startedAt = Date.now();
  let tempRoot: string | undefined;
  let sourceRepoPath: string | undefined;
  try {
    await fs.mkdir(snapshotRoot, { recursive: true });
    const repoResult = await runSnapshotGit(
      appPath,
      ["rev-parse", "--show-toplevel"],
      signal,
    );
    sourceRepoPath = await fs.realpath(repoResult.stdout.trim());
    const realAppPath = await fs.realpath(appPath);
    if (!pathIsInside(sourceRepoPath, realAppPath)) {
      throw new Error("The app path is outside its Git repository.");
    }
    const appRelativePath = path.relative(sourceRepoPath, realAppPath);
    const appRelativePosix = appRelativePath.split(path.sep).join("/");

    tempRoot = await fs.mkdtemp(path.join(snapshotRoot, SNAPSHOT_PREFIX));
    await writeSnapshotMarker(tempRoot, sourceRepoPath);
    const registeredSubmoduleWorktrees: SubmoduleWorktree[] = [];
    const emptyHooksPath = path.join(snapshotRoot, ".empty-hooks");
    await fs.mkdir(emptyHooksPath, { recursive: true });
    await runSnapshotGit(
      sourceRepoPath,
      [
        "-c",
        `core.hooksPath=${emptyHooksPath}`,
        "worktree",
        "add",
        "--detach",
        tempRoot,
        "HEAD",
      ],
      signal,
    );
    const snapshotAppPath = path.join(tempRoot, appRelativePath);
    await removeExcludedSnapshotRoots(
      sourceRepoPath,
      snapshotAppPath,
      appRelativePosix,
      signal,
    );
    await overlayWorkspaceState(
      sourceRepoPath,
      tempRoot,
      appRelativePosix,
      signal,
    );
    await materializeInitializedSubmodules(
      sourceRepoPath,
      tempRoot,
      tempRoot,
      sourceRepoPath,
      emptyHooksPath,
      registeredSubmoduleWorktrees,
      appRelativePosix,
      signal,
    );
    await secureSnapshotSymlinks(sourceRepoPath, tempRoot, signal);
    return {
      path: snapshotAppPath,
      worktreePath: tempRoot,
      setupMs: Date.now() - startedAt,
      strategy: "git-worktree-overlay",
      sourceAppPath: realAppPath,
      sourceRepoPath,
    };
  } catch (error) {
    if (tempRoot) void removeSnapshot(tempRoot, sourceRepoPath ?? appPath);
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      `Could not prepare the isolated build workspace: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.Precondition,
    );
  }
}

async function createSnapshot(
  appPath: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const snapshotRoot = getBuildSnapshotRoot();
  await fs.mkdir(snapshotRoot, { recursive: true });
  await removeStaleSnapshots(snapshotRoot);
  return createBuildWorktree(appPath, snapshotRoot, signal);
}

export async function removeStaleSnapshots(
  parentPath: string,
  options: { removeAll?: boolean } = {},
): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(parentPath);
  } catch (error) {
    logger.warn(
      `Failed to inspect stale build snapshots in ${parentPath}:`,
      error,
    );
    return;
  }

  const cutoff = Date.now() - STALE_SNAPSHOT_AGE_MS;
  await Promise.all(
    entries
      .filter((entry) => SNAPSHOT_NAME_PATTERN.test(entry))
      .map(async (entry) => {
        const snapshotPath = path.join(parentPath, entry);
        try {
          const [stat, marker] = await Promise.all([
            fs.lstat(snapshotPath),
            readSnapshotMarker(snapshotPath),
          ]);
          if (
            stat.isDirectory() &&
            marker &&
            (options.removeAll || stat.mtimeMs < cutoff)
          ) {
            await removeSnapshot(snapshotPath, marker.sourceRepoPath);
          }
        } catch (error) {
          logger.warn(
            `Failed to inspect build snapshot ${snapshotPath}:`,
            error,
          );
        }
      }),
  );
}

export async function cleanupStaleBuildSnapshots(): Promise<void> {
  const snapshotRoot = getBuildSnapshotRoot();
  await fs.mkdir(snapshotRoot, { recursive: true });
  await removeStaleSnapshots(snapshotRoot, { removeAll: true });
}

export async function removeSnapshot(
  snapshotPath: string,
  sourceRepoPath?: string,
): Promise<void> {
  const storedMarker = await readSnapshotMarker(snapshotPath);
  const marker = sourceRepoPath
    ? {
        sourceRepoPath,
        submoduleWorktrees: storedMarker?.submoduleWorktrees ?? [],
      }
    : storedMarker;
  for (const worktree of [...(marker?.submoduleWorktrees ?? [])].reverse()) {
    try {
      await runSnapshotGit(
        worktree.sourceRepoPath,
        ["worktree", "remove", "--force", worktree.snapshotPath],
        AbortSignal.timeout(30_000),
      );
    } catch (error) {
      logger.warn(
        `Failed to unregister build submodule worktree ${worktree.snapshotPath}:`,
        error,
      );
      try {
        await runSnapshotGit(
          worktree.sourceRepoPath,
          ["worktree", "prune"],
          AbortSignal.timeout(30_000),
        );
      } catch (pruneError) {
        logger.warn(
          `Failed to prune build submodule worktree metadata for ${worktree.sourceRepoPath}:`,
          pruneError,
        );
      }
    }
  }
  let removedByGit = false;
  if (marker?.sourceRepoPath) {
    try {
      await runSnapshotGit(
        marker.sourceRepoPath,
        ["worktree", "remove", "--force", snapshotPath],
        AbortSignal.timeout(30_000),
      );
      removedByGit = true;
    } catch (error) {
      logger.warn(
        `Failed to unregister build worktree ${snapshotPath}:`,
        error,
      );
    }
  }
  try {
    if (!removedByGit) {
      await fs.rm(snapshotPath, {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      });
    }
    await fs.rm(getSnapshotMarkerPath(snapshotPath), { force: true });
  } catch (error) {
    logger.warn(`Failed to remove build snapshot ${snapshotPath}:`, error);
  }
  if (!removedByGit && marker?.sourceRepoPath) {
    try {
      await runSnapshotGit(
        marker.sourceRepoPath,
        ["worktree", "prune"],
        AbortSignal.timeout(30_000),
      );
    } catch (error) {
      logger.warn(`Failed to prune stale build worktree metadata:`, error);
    }
  }
}

function tail(value: string): string {
  return value.length <= MAX_RESULT_OUTPUT_CHARS
    ? value
    : `[Earlier output omitted]\n${value.slice(-MAX_RESULT_OUTPUT_CHARS)}`;
}

export function accumulateBuildOutput(previous: string, chunk: string): string {
  return tail(previous + chunk);
}

export function createBuildOutputPreview(
  onPreview: (accumulatedOutput: string) => void,
  intervalMs = BUILD_OUTPUT_PREVIEW_INTERVAL_MS,
): { append: (chunk: string) => void; flush: () => void } {
  let accumulatedOutput = "";
  let lastPreviewedOutput = "";
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
    if (accumulatedOutput === lastPreviewedOutput) return;
    lastPreviewedOutput = accumulatedOutput;
    onPreview(accumulatedOutput);
  };

  return {
    append: (chunk) => {
      accumulatedOutput = accumulateBuildOutput(accumulatedOutput, chunk);
      if (timer) return;
      timer = setTimeout(flush, intervalMs);
    },
    flush,
  };
}

async function matchesWorkspacePatterns(
  workspaceRoot: string,
  appPath: string,
  workspaces: string[],
): Promise<boolean> {
  const positivePatterns = workspaces.filter(
    (workspace) => !workspace.startsWith("!"),
  );
  if (positivePatterns.length === 0) return false;
  const ignoredPatterns = workspaces
    .filter((workspace) => workspace.startsWith("!"))
    .map((workspace) => workspace.slice(1));
  const matches = await glob(positivePatterns, {
    cwd: workspaceRoot,
    absolute: true,
    follow: false,
    ignore: ignoredPatterns,
  });
  const realAppPath = await fs.realpath(appPath);
  for (const match of matches) {
    const realMatch = await fs.realpath(match).catch(() => null);
    if (realMatch === realAppPath) return true;
  }
  return false;
}

async function isNpmWorkspaceMember(
  workspaceRoot: string,
  appPath: string,
): Promise<boolean> {
  let packageJson: {
    workspaces?: string[] | { packages?: string[] };
  };
  try {
    packageJson = JSON.parse(
      await fs.readFile(path.join(workspaceRoot, "package.json"), "utf8"),
    ) as typeof packageJson;
  } catch {
    return false;
  }
  const workspaces = Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : packageJson.workspaces?.packages;
  return workspaces?.length
    ? matchesWorkspacePatterns(workspaceRoot, appPath, workspaces)
    : false;
}

async function isPnpmWorkspaceMember(
  workspaceRoot: string,
  appPath: string,
): Promise<boolean> {
  try {
    const parsed = parseYaml(
      await fs.readFile(
        path.join(workspaceRoot, "pnpm-workspace.yaml"),
        "utf8",
      ),
    ) as { packages?: unknown } | null;
    const workspaces = Array.isArray(parsed?.packages)
      ? parsed.packages.filter(
          (workspace): workspace is string => typeof workspace === "string",
        )
      : [];
    return workspaces.length > 0
      ? matchesWorkspacePatterns(workspaceRoot, appPath, workspaces)
      : false;
  } catch {
    return false;
  }
}

export async function findPackageManagerRoot(
  appPath: string,
  repoRoot: string,
): Promise<string> {
  let candidate = path.dirname(appPath);
  while (pathIsInside(repoRoot, candidate)) {
    if (
      (await isPnpmWorkspaceMember(candidate, appPath)) ||
      (await isNpmWorkspaceMember(candidate, appPath))
    ) {
      return candidate;
    }
    if (candidate === repoRoot) break;
    candidate = path.dirname(candidate);
  }
  return appPath;
}

async function resolvePackageManager(appPath: string, repoRoot = appPath) {
  const support = await getPnpmMinimumReleaseAgeSupport();
  const sourceInstallPath = await findPackageManagerRoot(appPath, repoRoot);
  return {
    packageManager: choosePackageManagerForApp(
      sourceInstallPath,
      support.available,
    ),
    sourceInstallPath,
  };
}

export function getCleanInstallArgs({
  packageManager,
  hasLockfile,
}: {
  packageManager: "npm" | "pnpm";
  hasLockfile: boolean;
}): string[] {
  if (packageManager === "pnpm") {
    return [
      ...PNPM_INSTALL_POLICY_ARGS,
      "install",
      ...(hasLockfile ? ["--frozen-lockfile"] : []),
      "--prefer-offline",
    ];
  }
  return [
    hasLockfile ? "ci" : "install",
    "--legacy-peer-deps",
    "--prefer-offline",
  ];
}

async function runSnapshotInstallProcess({
  cwd,
  packageManager,
  signal,
  timeoutMs,
  onOutput,
}: {
  cwd: string;
  packageManager: "npm" | "pnpm";
  signal?: AbortSignal;
  timeoutMs: number;
  onOutput: (chunk: string) => void;
}) {
  const lockfileName =
    packageManager === "pnpm" ? "pnpm-lock.yaml" : "package-lock.json";
  const hasLockfile = await fs
    .stat(path.join(cwd, lockfileName))
    .then((stat) => stat.isFile())
    .catch(() => false);
  return spawnStreaming({
    command: packageManager,
    args: getCleanInstallArgs({ packageManager, hasLockfile }),
    cwd,
    env: getPackageManagerCommandEnv(),
    signal,
    timeoutMs,
    onOutput,
  });
}

async function runBuildProcess({
  cwd,
  packageManager,
  signal,
  timeoutMs,
  onOutput,
}: {
  cwd: string;
  packageManager: "npm" | "pnpm";
  signal?: AbortSignal;
  timeoutMs: number;
  onOutput: (chunk: string) => void;
}) {
  return spawnStreaming({
    command: packageManager,
    args: ["run", "build"],
    cwd,
    env: getPackageManagerCommandEnv(),
    signal,
    timeoutMs,
    onOutput,
  });
}

interface BuildAbortScope {
  signal: AbortSignal;
  deadlineAt: number;
  timedOut: () => boolean;
  dispose: () => void;
}

function createBuildAbortScope(userSignal?: AbortSignal): BuildAbortScope {
  const controller = new AbortController();
  const deadlineAt = Date.now() + BUILD_TIMEOUT_MS;
  let didTimeOut = false;
  const abortForUser = () => controller.abort(userSignal?.reason);
  if (userSignal?.aborted) abortForUser();
  else userSignal?.addEventListener("abort", abortForUser, { once: true });
  const timer = setTimeout(() => {
    didTimeOut = true;
    controller.abort(new Error("Production build deadline exceeded"));
  }, BUILD_TIMEOUT_MS);
  return {
    signal: controller.signal,
    deadlineAt,
    timedOut: () => didTimeOut,
    dispose: () => {
      clearTimeout(timer);
      userSignal?.removeEventListener("abort", abortForUser);
    },
  };
}

function streamBuildOutput(ctx: AgentContext, accumulatedOutput: string): void {
  const output = accumulatedOutput.trim();
  if (!output) return;
  ctx.onXmlStream(
    `<dyad-status title="Production build output">\n${escapeXmlContent(output)}\n</dyad-status>`,
  );
}

export const runBuildTool: ToolDefinition<z.infer<typeof runBuildSchema>> = {
  name: "run_build",
  description: `Run the app's production build as a selective, expensive verification step.

- Use after build configuration, dependencies, framework routing, server/static-generation, environment loading, or substantial production-path changes, or when the user explicitly asks.
- Do not use after routine small UI, styling, copy, or asset edits. Type checking is the normal verification step.
- Finish related edits first and run once. A failed build may be retried only after making a relevant change.
- The preview is never stopped. Standard Vite and preview-safe Next.js 16+ builds run in place. Unknown concurrent builds use a detached Git worktree containing the current workspace changes and freshly installed dependencies while a preview is running.`,
  inputSchema: runBuildSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: () =>
    "Runs the app's current package.json build lifecycle (prebuild, build, and postbuild). An isolated build may prepare a temporary Git worktree and install dependencies first. This executes project and dependency code with your user account. The temporary worktree protects the live preview from ordinary build output, but is not a security sandbox.",

  buildXml: (_args, isComplete) =>
    isComplete
      ? undefined
      : '<dyad-status title="Running production build"></dyad-status>',

  execute: async (_args, ctx) => {
    if (activeBuilds.has(ctx.appId)) {
      const body =
        "A production build is already running for this app. Wait for it to finish instead of starting another one.";
      completeStatus(ctx, "Build already running", body, "warning");
      return body;
    }

    activeBuilds.add(ctx.appId);
    try {
      return await appOperationCoordinator.run(
        {
          appId: ctx.appId,
          operation: "run production build",
          resources: [
            readAppResource("app-path"),
            { resource: "repository-worktree", mode: "write" },
            readAppResource("runtime"),
          ],
          refuseWhenRecording: "run a production build",
        },
        async () => {
          const state = (ctx.buildAttemptState ??= {
            count: 0,
          } satisfies BuildAttemptState);
          const currentMutationCount = ctx.mutationCount ?? 0;
          if (runningApps.get(ctx.appId)?.mode === "cloud") {
            throw new DyadError(
              "Production build verification is unavailable while this app is running in a cloud sandbox because the build would run on the host instead of inside that sandbox. Switch the app runtime to Host and try again.",
              DyadErrorKind.Precondition,
            );
          }
          if (state.count >= MAX_BUILD_RUNS_PER_TURN) {
            const body = `The ${MAX_BUILD_RUNS_PER_TURN}-build limit for this turn has been reached. Stop retrying and summarize the remaining build issue for the user.`;
            completeStatus(ctx, "Build limit reached", body, "warning");
            return body;
          }
          if (
            state.count > 0 &&
            state.mutationCountAtLastRun === currentMutationCount
          ) {
            const body =
              "The workspace has not changed since the previous production build. Do not run it again until you make a relevant fix.";
            completeStatus(ctx, "Build not repeated", body, "warning");
            return body;
          }
          if (state.mutationCountAtLastSetupFailure === currentMutationCount) {
            const body =
              "Isolated build setup already failed for this unchanged workspace. Do not run the production build again until you make a relevant fix.";
            completeStatus(ctx, "Build setup not repeated", body, "warning");
            return body;
          }

          const packageJson = await readPackageJson(ctx.appPath);
          const buildScript = getScript(packageJson, "build");
          if (!buildScript) {
            throw new DyadError(
              "This app does not define a package.json scripts.build command, so production build verification is unavailable.",
              DyadErrorKind.Precondition,
            );
          }
          const facts = await gatherBuildProjectFacts(
            ctx,
            buildScript,
            Boolean(
              getScript(packageJson, "prebuild") ||
              getScript(packageJson, "postbuild"),
            ),
          );
          const mode = selectBuildExecutionMode(facts);

          ctx.onXmlStream(
            `<dyad-status title="${escapeXmlAttr(mode === "in-place" ? "Building beside preview" : "Preparing isolated build")}"></dyad-status>`,
          );
          const abortScope = createBuildAbortScope(ctx.abortSignal);
          const operationStartedAt = Date.now();
          let snapshot: Snapshot | undefined;
          let dependencyInstallMs = 0;
          let phase: "snapshot setup" | "dependency installation" | "build" =
            "snapshot setup";
          try {
            let packageManager: "npm" | "pnpm";
            if (mode === "isolated") {
              snapshot = await createSnapshot(ctx.appPath, abortScope.signal);
              const packageManagerResolution = await resolvePackageManager(
                snapshot.sourceAppPath,
                snapshot.sourceRepoPath,
              );
              packageManager = packageManagerResolution.packageManager;
              const snapshotInstallPath = path.join(
                snapshot.worktreePath,
                path.relative(
                  snapshot.sourceRepoPath,
                  packageManagerResolution.sourceInstallPath,
                ),
              );
              phase = "dependency installation";
              ctx.onXmlStream(
                '<dyad-status title="Installing isolated build dependencies"></dyad-status>',
              );
              const installOutputPreview = createBuildOutputPreview((output) =>
                streamBuildOutput(ctx, output),
              );
              const installStartedAt = Date.now();
              const installResult = await runSnapshotInstallProcess({
                cwd: snapshotInstallPath,
                packageManager,
                signal: abortScope.signal,
                timeoutMs: Math.max(1, abortScope.deadlineAt - Date.now()),
                onOutput: installOutputPreview.append,
              }).finally(installOutputPreview.flush);
              dependencyInstallMs = Date.now() - installStartedAt;
              const installOutput = tail(
                [installResult.stdout, installResult.stderr]
                  .filter(Boolean)
                  .join("\n"),
              );
              if (abortScope.timedOut() || installResult.timedOut) {
                state.mutationCountAtLastSetupFailure = currentMutationCount;
                const body = `Production build timed out after 10 minutes during dependency installation.\n\n${installOutput}`;
                completeStatus(ctx, "Build timed out", body, "warning");
                return body;
              }
              if (installResult.aborted) {
                throw new DyadError(
                  "Build cancelled.",
                  DyadErrorKind.UserCancelled,
                );
              }
              if (installResult.code !== 0) {
                state.mutationCountAtLastSetupFailure = currentMutationCount;
                const body = `Could not install dependencies for the isolated production build (exit code ${installResult.code}). The build was not attempted.\n\n${installOutput}`;
                completeStatus(
                  ctx,
                  "Dependency installation failed",
                  body,
                  "warning",
                );
                return body;
              }
              state.mutationCountAtLastSetupFailure = undefined;
            } else {
              packageManager = (await resolvePackageManager(ctx.appPath))
                .packageManager;
            }
            phase = "build";
            state.count += 1;
            state.mutationCountAtLastRun = currentMutationCount;
            ctx.onXmlStream(
              '<dyad-status title="Running production build"></dyad-status>',
            );
            const buildStartedAt = Date.now();
            const buildOutputPreview = createBuildOutputPreview((output) =>
              streamBuildOutput(ctx, output),
            );
            const result = await runBuildProcess({
              cwd: snapshot?.path ?? ctx.appPath,
              packageManager,
              signal: abortScope.signal,
              timeoutMs: Math.max(1, abortScope.deadlineAt - Date.now()),
              onOutput: buildOutputPreview.append,
            }).finally(buildOutputPreview.flush);
            const buildMs = Date.now() - buildStartedAt;
            const timing = snapshot
              ? `Mode: isolated (${snapshot.strategy}); snapshot setup: ${snapshot.setupMs} ms; dependency install: ${dependencyInstallMs} ms; build: ${buildMs} ms.`
              : `Mode: in-place; build: ${buildMs} ms.`;
            const output = tail(
              [result.stdout, result.stderr].filter(Boolean).join("\n"),
            );

            if (abortScope.timedOut() || result.timedOut) {
              const body = `Production build timed out after 10 minutes. ${timing}\n\n${output}`;
              completeStatus(ctx, "Build timed out", body, "warning");
              return body;
            }
            if (result.aborted) {
              throw new DyadError(
                "Build cancelled.",
                DyadErrorKind.UserCancelled,
              );
            }
            if (result.code !== 0) {
              const body = `Production build failed with exit code ${result.code}. ${timing}\n\n${output}`;
              completeStatus(ctx, "Build failed", body, "warning");
              return body;
            }

            const body = `Production build passed. ${timing}${output ? `\n\n${output}` : ""}`;
            completeStatus(ctx, "Build passed", body);
            return body;
          } catch (error) {
            if (phase === "snapshot setup" && !ctx.abortSignal?.aborted) {
              state.mutationCountAtLastSetupFailure = currentMutationCount;
            }
            if (abortScope.timedOut()) {
              const elapsedMs = Date.now() - operationStartedAt;
              const body = `Production build timed out after 10 minutes during ${phase}. Elapsed: ${elapsedMs} ms.`;
              completeStatus(ctx, "Build timed out", body, "warning");
              return body;
            }
            throw error;
          } finally {
            abortScope.dispose();
            if (snapshot) {
              void removeSnapshot(
                snapshot.worktreePath,
                snapshot.sourceRepoPath,
              );
            }
          }
        },
      );
    } finally {
      activeBuilds.delete(ctx.appId);
    }
  },
};
