import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";

import log from "electron-log/main";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { runBufferedProcess } from "@/ipc/utils/buffered_process";
import { getGitProcessEnvironment } from "@/ipc/utils/git_utils";
import { isMissingPathError } from "../../../shared/node_module_resolution";

const WINDOWS_COPY_CONCURRENCY = 32;
const MAX_GIT_OUTPUT_BYTES = 4 * 1024 * 1024;
const MARKER_SUFFIX = ".owner.json";
const MARKER_SCHEMA = "dyad-git-overlay-worktree-v1";
const LEGACY_BUILD_MARKER_SCHEMA = "dyad-build-worktree-v1";
/**
 * Roots dropped at ANY depth in the repository, and never preserved even when
 * Git tracks them.
 *
 * These are installed environments, not sources: a dependency tree or a
 * virtualenv records absolute paths in its own metadata (`pyvenv.cfg`, script
 * shebangs, `.bin` links), so a copy of one points back at the live checkout
 * and a sandbox that activated it would quietly escape itself. Every consumer
 * of this workspace installs its own, so a committed one is never what the run
 * should resolve against.
 *
 * Distinct from the caller's `excludedTargetRootNames`, which are generated
 * *output* names anchored at the app directory — `rules/local-agent-tools.md`
 * warns those must not match at every depth, because `app/out/page.tsx` is
 * application source. Nothing here is ever a source directory, so the same
 * caution does not apply.
 */
const ALWAYS_EXCLUDED_ROOTS: ReadonlySet<string> = new Set([
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".yarn",
  ".pnpm-store",
  ".gradle",
  "Pods",
  ".turbo",
]);

const logger = log.scope("git_overlay_workspace");
const activeWorkspacePaths = new Set<string>();

export type GitOverlayWorkspacePurpose = "build" | "e2e-test";

export interface GitOverlayWorkspace {
  /** The target app directory inside the detached worktree. */
  targetPath: string;
  /** The detached repository worktree root. */
  worktreePath: string;
  setupMs: number;
  sourceTargetPath: string;
  sourceRepoPath: string;
}

interface SubmoduleWorktree {
  sourceRepoPath: string;
  snapshotPath: string;
}

export interface GitOverlayWorkspaceMarker {
  schema: typeof MARKER_SCHEMA | typeof LEGACY_BUILD_MARKER_SCHEMA;
  purpose: GitOverlayWorkspacePurpose;
  sourceRepoPath: string;
  submoduleWorktrees: SubmoduleWorktree[];
}

export interface GitOverlayWorkspaceOptions {
  sourceTargetPath: string;
  scratchRoot: string;
  directoryPrefix: string;
  purpose: GitOverlayWorkspacePurpose;
  excludedTargetRootNames: ReadonlySet<string>;
  cleanupFailureMode?: "await" | "background";
  signal?: AbortSignal;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DyadError("Operation cancelled.", DyadErrorKind.UserCancelled);
  }
}

async function runWorkspaceGit(
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
    throw new DyadError("Operation cancelled.", DyadErrorKind.UserCancelled);
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

function pathIsInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative === "" ||
    (!path.isAbsolute(relative) &&
      relative !== ".." &&
      !relative.startsWith(`..${path.sep}`))
  );
}

function isExcludedRelativePath(
  normalized: string,
  targetRelativePath: string,
  excludedTargetRootNames: ReadonlySet<string>,
): boolean {
  const segments = normalized.split("/");
  if (
    segments.includes(".git") ||
    segments.some((segment) => ALWAYS_EXCLUDED_ROOTS.has(segment))
  ) {
    return true;
  }
  const normalizedTargetPath = targetRelativePath
    ? path.posix.normalize(targetRelativePath)
    : "";
  const pathWithinTarget = normalizedTargetPath
    ? normalized === normalizedTargetPath
      ? ""
      : normalized.startsWith(`${normalizedTargetPath}/`)
        ? normalized.slice(normalizedTargetPath.length + 1)
        : null
    : normalized;
  if (pathWithinTarget === null || pathWithinTarget === "") return false;
  // An excluded entry is a path relative to the app directory, so it can name
  // more than one segment (`playwright/.cache`). Anchored at the app root
  // either way: a bare name is NOT matched at every depth, because
  // `app/out/page.tsx` is source rather than build output.
  return [...excludedTargetRootNames].some(
    (entry) =>
      pathWithinTarget === entry || pathWithinTarget.startsWith(`${entry}/`),
  );
}

function normalizeRelativePath(
  rawPath: string,
  targetRelativePath: string,
  excludedTargetRootNames: ReadonlySet<string>,
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
  return isExcludedRelativePath(
    normalized,
    targetRelativePath,
    excludedTargetRootNames,
  )
    ? null
    : normalized;
}

export function parseGitOverlayPaths(
  statusOutput: string,
  targetRelativePath: string,
  excludedTargetRootNames: ReadonlySet<string>,
): string[] {
  const fields = statusOutput.split("\0");
  const paths = new Set<string>();
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index];
    if (!field || field.length < 4) continue;
    const status = field.slice(0, 2);
    const currentPath = normalizeRelativePath(
      field.slice(3),
      targetRelativePath,
      excludedTargetRootNames,
    );
    if (currentPath) paths.add(currentPath);
    if (status.includes("R") || status.includes("C")) {
      const previousPath = normalizeRelativePath(
        fields[index + 1] ?? "",
        targetRelativePath,
        excludedTargetRootNames,
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

function toNativePath(relativePath: string): string {
  return path.join(...relativePath.split("/"));
}

async function overlayPath(
  sourceRoot: string,
  realSourceRoot: string,
  workspaceRoot: string,
  relativePath: string,
  targetRelativePath: string,
  excludedTargetRootNames: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  throwIfCancelled(signal);
  const nativeRelativePath = toNativePath(relativePath);
  const sourcePath = path.join(sourceRoot, nativeRelativePath);
  const destinationPath = path.join(workspaceRoot, nativeRelativePath);
  await fs.rm(destinationPath, { recursive: true, force: true });
  const sourceStat = await fs.lstat(sourcePath).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!sourceStat) return;
  await fs.mkdir(path.dirname(destinationPath), { recursive: true });
  if (process.platform === "win32") {
    await copyGitOverlayEntriesOnWindows({
      sourceRoot,
      realSourceRoot,
      workspaceRoot,
      initialPaths: [sourcePath],
      signal,
      targetRelativePath,
      excludedTargetRootNames,
    });
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
      return !isExcludedRelativePath(
        candidateRelativePath,
        targetRelativePath,
        excludedTargetRootNames,
      );
    },
  });
  throwIfCancelled(signal);
}

async function overlayWorkspaceState(
  sourceRoot: string,
  workspaceRoot: string,
  targetRelativePath: string,
  excludedTargetRootNames: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<void> {
  const status = await runWorkspaceGit(
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
  const overlayPaths = parseGitOverlayPaths(
    status.stdout,
    targetRelativePath,
    excludedTargetRootNames,
  );
  const realSourceRoot = await fs.realpath(sourceRoot);
  for (
    let index = 0;
    index < overlayPaths.length;
    index += WINDOWS_COPY_CONCURRENCY
  ) {
    // Settled, not `Promise.all`. A rejection there resolves this await while
    // sibling copies are still reading the source and writing the worktree, and
    // the caller starts removing that worktree — and releases the repository
    // claim — with those copies still running. `rules/app-operation-coordination.md`
    // requires the barrier for exactly this shape.
    const settled = await Promise.allSettled(
      overlayPaths
        .slice(index, index + WINDOWS_COPY_CONCURRENCY)
        .map((relativePath) =>
          overlayPath(
            sourceRoot,
            realSourceRoot,
            workspaceRoot,
            relativePath,
            targetRelativePath,
            excludedTargetRootNames,
            signal,
          ),
        ),
    );
    const failure = settled.find((outcome) => outcome.status === "rejected");
    if (failure) throw failure.reason;
  }
}

export async function copyGitOverlayEntriesOnWindows({
  sourceRoot,
  realSourceRoot,
  workspaceRoot,
  initialPaths,
  signal,
  targetRelativePath = "",
  excludedTargetRootNames = new Set<string>(),
}: {
  sourceRoot: string;
  realSourceRoot: string;
  workspaceRoot: string;
  initialPaths: string[];
  signal?: AbortSignal;
  targetRelativePath?: string;
  excludedTargetRootNames?: ReadonlySet<string>;
}): Promise<void> {
  const pendingPaths = [...initialPaths];
  while (pendingPaths.length > 0) {
    throwIfCancelled(signal);
    const batch = pendingPaths.splice(0, WINDOWS_COPY_CONCURRENCY);
    const settled = await Promise.allSettled(
      batch.map((sourcePath) =>
        copyWindowsEntry({
          sourceRoot,
          realSourceRoot,
          workspaceRoot,
          sourcePath,
          signal,
          targetRelativePath,
          excludedTargetRootNames,
        }),
      ),
    );
    const failure = settled.find((outcome) => outcome.status === "rejected");
    if (failure) throw failure.reason;
    pendingPaths.push(
      ...settled.flatMap((outcome) =>
        outcome.status === "fulfilled" ? outcome.value : [],
      ),
    );
  }
}

async function copyWindowsEntry({
  sourceRoot,
  realSourceRoot,
  workspaceRoot,
  sourcePath,
  signal,
  targetRelativePath,
  excludedTargetRootNames,
}: {
  sourceRoot: string;
  realSourceRoot: string;
  workspaceRoot: string;
  sourcePath: string;
  signal?: AbortSignal;
  targetRelativePath: string;
  excludedTargetRootNames: ReadonlySet<string>;
}): Promise<string[]> {
  throwIfCancelled(signal);
  const sourceRelativePath = path
    .relative(sourceRoot, sourcePath)
    .split(path.sep)
    .join("/");
  if (
    isExcludedRelativePath(
      sourceRelativePath,
      targetRelativePath,
      excludedTargetRootNames,
    )
  ) {
    return [];
  }
  const destinationPath = path.join(
    workspaceRoot,
    path.relative(sourceRoot, sourcePath),
  );
  const stat = await fs.lstat(sourcePath);
  if (stat.isSymbolicLink()) {
    let realTarget: string;
    try {
      realTarget = await fs.realpath(sourcePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // A dangling link. Dropping it here is what the POSIX path deliberately
      // stopped doing: an app may keep a repository-local link whose target its
      // install or build step creates, and omitting it made an isolated run
      // fail on Windows only. Preserved under the same containment rule, with
      // the text remapped so a target created later resolves inside the
      // workspace instead of back into the live checkout.
      const linkText = await fs.readlink(sourcePath);
      const textualTarget = path.resolve(path.dirname(sourcePath), linkText);
      if (!pathIsInside(realSourceRoot, textualTarget)) {
        logger.warn(
          `Dropping the dangling link ${path.relative(sourceRoot, sourcePath)} from the workspace: its target would land outside the repository.`,
        );
        return [];
      }
      await fs.symlink(
        path.join(workspaceRoot, path.relative(realSourceRoot, textualTarget)),
        destinationPath,
        "file",
      );
      return [];
    }
    if (!pathIsInside(realSourceRoot, realTarget)) {
      throw externalLinkError(path.relative(sourceRoot, sourcePath));
    }
    const targetStat = await fs.stat(realTarget);
    const mappedTarget = path.join(
      workspaceRoot,
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

function externalLinkError(relativePath: string): DyadError {
  return new DyadError(
    `Cannot isolate the linked path ${relativePath} because it points outside the Git repository. Replace the external link with a repository-local dependency before trying again.`,
    DyadErrorKind.Precondition,
  );
}

interface WorkspaceEntryInfo {
  entryPath: string;
  isDirectory: boolean;
  isSymbolicLink: boolean;
}

async function inspectEntries(
  directory: string,
): Promise<WorkspaceEntryInfo[]> {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  if (process.platform !== "win32") {
    return entries.map((entry) => ({
      entryPath: path.join(directory, entry.name),
      isDirectory: entry.isDirectory(),
      isSymbolicLink: entry.isSymbolicLink(),
    }));
  }
  const inspected: WorkspaceEntryInfo[] = [];
  for (
    let index = 0;
    index < entries.length;
    index += WINDOWS_COPY_CONCURRENCY
  ) {
    inspected.push(
      ...(await Promise.all(
        entries
          .slice(index, index + WINDOWS_COPY_CONCURRENCY)
          .map(async (entry) => {
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

export async function secureGitOverlaySymlinks(
  sourceRoot: string,
  workspaceRoot: string,
  signal?: AbortSignal,
): Promise<void> {
  const [realSourceRoot, realWorkspaceRoot] = await Promise.all([
    fs.realpath(sourceRoot),
    fs.realpath(workspaceRoot),
  ]);
  const pendingDirectories = [workspaceRoot];
  while (pendingDirectories.length > 0) {
    throwIfCancelled(signal);
    const directory = pendingDirectories.pop();
    if (!directory) break;
    const entries = await inspectEntries(directory);
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
          // A dangling link, which repositories legitimately contain — a link
          // to something a build step produces, say. Kept rather than deleted,
          // because silently removing it makes the workspace differ from the
          // tree it reproduces. But "resolves to nothing" is not "harmless":
          // the target is exactly the thing a later install or build step
          // creates, and a link still pointing at the LIVE path would then read
          // and write straight through the sandbox into the user's checkout.
          // So the same remap the resolved branch performs is applied to the
          // link text.
          //
          // Resolved through `realWorkspaceRoot`, not the raw `entryPath`: the
          // walk starts at the unresolved `workspaceRoot`, so on a root with a
          // symlinked ancestor (`/var` → `/private/var`, or any dev user-data
          // dir behind a link) an ordinary in-workspace relative link would
          // resolve to a prefix that matches neither root and be refused.
          const linkText = await fs.readlink(entry.entryPath);
          const realEntryPath = path.join(
            realWorkspaceRoot,
            path.relative(workspaceRoot, entry.entryPath),
          );
          const textualTarget = path.resolve(
            path.dirname(realEntryPath),
            linkText,
          );
          if (pathIsInside(realWorkspaceRoot, textualTarget)) {
            // Already points inside the copy — relative links that stayed
            // relative land here, and there is nothing to rewrite.
            continue;
          }
          if (pathIsInside(realSourceRoot, textualTarget)) {
            const mapped = path.join(
              realWorkspaceRoot,
              path.relative(realSourceRoot, textualTarget),
            );
            await fs.rm(entry.entryPath, { force: true });
            await fs.symlink(
              process.platform === "win32"
                ? mapped
                : path.relative(path.dirname(realEntryPath), mapped) || ".",
              entry.entryPath,
              "file",
            );
            continue;
          }
          // Outside both roots. Dropped rather than fatal: it resolves to
          // nothing today, so it cannot be a way out, and failing the whole
          // workspace over one stale link would turn a repository that merely
          // contains it into a build that cannot run at all.
          logger.warn(
            `Dropping the dangling link ${path.relative(workspaceRoot, entry.entryPath)} from the workspace: its target would land outside the repository.`,
          );
          await fs.unlink(entry.entryPath);
          continue;
        }
        throw new DyadError(
          `Cannot isolate the linked path ${path.relative(workspaceRoot, entry.entryPath)} because its target is unavailable.`,
          DyadErrorKind.Precondition,
        );
      }
      if (pathIsInside(realWorkspaceRoot, realTarget)) continue;
      if (!pathIsInside(realSourceRoot, realTarget)) {
        throw externalLinkError(path.relative(workspaceRoot, entry.entryPath));
      }
      const mappedTarget = path.join(
        realWorkspaceRoot,
        path.relative(realSourceRoot, realTarget),
      );
      const realEntryPath = path.join(
        realWorkspaceRoot,
        path.relative(workspaceRoot, entry.entryPath),
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

function markerPath(worktreePath: string): string {
  return `${worktreePath}${MARKER_SUFFIX}`;
}

/**
 * Written through a temporary file and renamed into place. The marker is
 * rewritten each time a submodule worktree is registered, and a crash during a
 * plain truncating write would leave the orphan sweep with an unreadable owner
 * file — which it reads as "not ours" and skips forever, stranding the
 * worktree and its registrations. `rename` is atomic within the directory, so
 * a reader sees either the previous marker or the new one.
 */
async function writeMarker(
  worktreePath: string,
  marker: Omit<GitOverlayWorkspaceMarker, "schema">,
): Promise<void> {
  const destinationPath = markerPath(worktreePath);
  const temporaryPath = `${destinationPath}.${process.pid}.tmp`;
  await fs.writeFile(
    temporaryPath,
    JSON.stringify({ schema: MARKER_SCHEMA, ...marker }),
    "utf8",
  );
  try {
    await fs.rename(temporaryPath, destinationPath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => {});
    throw error;
  }
}

export async function readGitOverlayWorkspaceMarker(
  worktreePath: string,
): Promise<GitOverlayWorkspaceMarker | null> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(markerPath(worktreePath), "utf8"),
    ) as Partial<GitOverlayWorkspaceMarker>;
    if (
      (parsed.schema !== MARKER_SCHEMA &&
        parsed.schema !== LEGACY_BUILD_MARKER_SCHEMA) ||
      typeof parsed.sourceRepoPath !== "string" ||
      !path.isAbsolute(parsed.sourceRepoPath)
    ) {
      return null;
    }
    const purpose =
      parsed.schema === LEGACY_BUILD_MARKER_SCHEMA ? "build" : parsed.purpose;
    if (purpose !== "build" && purpose !== "e2e-test") return null;
    const submoduleWorktrees = Array.isArray(parsed.submoduleWorktrees)
      ? parsed.submoduleWorktrees.filter(
          (worktree): worktree is SubmoduleWorktree =>
            typeof worktree === "object" &&
            worktree !== null &&
            typeof worktree.sourceRepoPath === "string" &&
            path.isAbsolute(worktree.sourceRepoPath) &&
            typeof worktree.snapshotPath === "string" &&
            path.isAbsolute(worktree.snapshotPath) &&
            pathIsInside(worktreePath, worktree.snapshotPath),
        )
      : [];
    return {
      schema: parsed.schema,
      purpose,
      sourceRepoPath: parsed.sourceRepoPath,
      submoduleWorktrees,
    };
  } catch {
    return null;
  }
}

/**
 * Delete the disposable roots `git worktree add` just checked out, and report
 * which ones were actually removed so the overlay knows what it must keep
 * excluding.
 *
 * A root Git tracks content under is a build *input*, not output, so committed
 * `dist`/`out` is preserved — which also means the overlay has to carry the
 * live working-tree version of those files rather than leave the stale `HEAD`
 * copy behind. `node_modules` is the one root removed even when tracked: every
 * consumer installs a clean dependency tree, so a committed one is never what
 * the run should resolve imports against.
 */
async function removeExcludedTargetRoots(
  sourceRepoPath: string,
  targetPath: string,
  targetRelativePath: string,
  excludedTargetRootNames: ReadonlySet<string>,
  signal?: AbortSignal,
): Promise<ReadonlySet<string>> {
  const excludedRootNames = [...excludedTargetRootNames];
  const excludedPaths = excludedRootNames.map((entry) =>
    targetRelativePath ? path.posix.join(targetRelativePath, entry) : entry,
  );
  if (excludedPaths.length === 0) return excludedTargetRootNames;
  const tracked = await runWorkspaceGit(
    sourceRepoPath,
    ["ls-files", "-z", "--", ...excludedPaths],
    signal,
  );
  const trackedPaths = tracked.stdout.split("\0").filter(Boolean);
  const removedRootNames = new Set<string>();
  await Promise.all(
    excludedRootNames.map((entry, index) => {
      const excludedPath = excludedPaths[index];
      if (
        !ALWAYS_EXCLUDED_ROOTS.has(entry) &&
        trackedPaths.some(
          (trackedPath) =>
            trackedPath === excludedPath ||
            trackedPath.startsWith(`${excludedPath}/`),
        )
      ) {
        return Promise.resolve();
      }
      removedRootNames.add(entry);
      return fs.rm(path.join(targetPath, entry), {
        recursive: true,
        force: true,
      });
    }),
  );
  return removedRootNames;
}

/**
 * Delete every checked-out environment root, at any depth in the worktree.
 *
 * `removeExcludedTargetRoots` only sweeps the app directory, and Node resolves
 * up through *every* ancestor — so for `/repo/groups/app`, a tracked
 * `/repo/groups/node_modules` from `HEAD` would still satisfy an import the
 * clean install never provided. The same goes for a committed virtualenv
 * anywhere in a monorepo: the sandbox would activate an interpreter pointing
 * back at the live checkout.
 *
 * Driven by `git ls-files` rather than a directory walk. Only tracked paths can
 * exist in a fresh `worktree add`, so this is the exact set, and it costs one
 * Git call instead of descending a tree that may hold hundreds of thousands of
 * files.
 */
async function removeAlwaysExcludedRoots(
  sourceRepoPath: string,
  worktreePath: string,
  signal?: AbortSignal,
): Promise<void> {
  const tracked = await runWorkspaceGit(
    sourceRepoPath,
    ["ls-files", "-z"],
    signal,
  );
  const roots = new Set<string>();
  for (const trackedPath of tracked.stdout.split("\0")) {
    if (!trackedPath) continue;
    const segments = trackedPath.split("/");
    const index = segments.findIndex((segment) =>
      ALWAYS_EXCLUDED_ROOTS.has(segment),
    );
    if (index >= 0) roots.add(segments.slice(0, index + 1).join("/"));
  }
  await Promise.all(
    [...roots].map((root) =>
      fs.rm(path.join(worktreePath, toNativePath(root)), {
        recursive: true,
        force: true,
      }),
    ),
  );
}

async function materializeInitializedSubmodules({
  sourceRepoPath,
  workspaceRepoPath,
  ownerWorktreePath,
  purpose,
  ownerSourceRepoPath,
  emptyHooksPath,
  registeredWorktrees,
  targetRelativePath,
  excludedTargetRootNames,
  signal,
}: {
  sourceRepoPath: string;
  workspaceRepoPath: string;
  ownerWorktreePath: string;
  purpose: GitOverlayWorkspacePurpose;
  ownerSourceRepoPath: string;
  emptyHooksPath: string;
  registeredWorktrees: SubmoduleWorktree[];
  targetRelativePath: string;
  excludedTargetRootNames: ReadonlySet<string>;
  signal?: AbortSignal;
}): Promise<void> {
  const gitmodulesPath = path.join(sourceRepoPath, ".gitmodules");
  const hasGitmodules = await fs
    .stat(gitmodulesPath)
    .then((stat) => stat.isFile())
    .catch(() => false);
  if (!hasGitmodules) return;
  const config = await runWorkspaceGit(
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
    const relativePath = normalizeRelativePath(
      entry.slice(separatorIndex + 1),
      targetRelativePath,
      excludedTargetRootNames,
    );
    if (!relativePath) continue;
    const sourceSubmodulePath = path.join(
      sourceRepoPath,
      toNativePath(relativePath),
    );
    // A submodule path replaced by a symlink to another checkout would
    // otherwise be followed here: `git worktree add` would run against that
    // external repository, registering a worktree in its Git metadata and
    // pulling its files into a workspace that is supposed to be a copy of this
    // one. Resolve the link before touching it and refuse anything that leaves
    // the source repository.
    const realSubmodulePath = await fs
      .realpath(sourceSubmodulePath)
      .catch(() => null);
    if (!realSubmodulePath) continue;
    if (!pathIsInside(sourceRepoPath, realSubmodulePath)) {
      throw externalLinkError(relativePath);
    }
    const initialized = await fs
      .lstat(path.join(realSubmodulePath, ".git"))
      .then(() => true)
      .catch(() => false);
    if (!initialized) continue;
    const snapshotSubmodulePath = path.join(
      workspaceRepoPath,
      toNativePath(relativePath),
    );
    const childTargetRelativePath = !targetRelativePath
      ? ""
      : relativePath === targetRelativePath
        ? ""
        : relativePath.startsWith(`${targetRelativePath}/`)
          ? ""
          : targetRelativePath.startsWith(`${relativePath}/`)
            ? targetRelativePath.slice(relativePath.length + 1)
            : "__outside_target_app__";
    registeredWorktrees.push({
      sourceRepoPath: realSubmodulePath,
      snapshotPath: snapshotSubmodulePath,
    });
    await writeMarker(ownerWorktreePath, {
      purpose,
      sourceRepoPath: ownerSourceRepoPath,
      submoduleWorktrees: registeredWorktrees,
    });
    await fs.rm(snapshotSubmodulePath, { recursive: true, force: true });
    await runWorkspaceGit(
      realSubmodulePath,
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
      realSubmodulePath,
      snapshotSubmodulePath,
      childTargetRelativePath,
      excludedTargetRootNames,
      signal,
    );
    await materializeInitializedSubmodules({
      sourceRepoPath: realSubmodulePath,
      workspaceRepoPath: snapshotSubmodulePath,
      ownerWorktreePath,
      purpose,
      ownerSourceRepoPath,
      emptyHooksPath,
      registeredWorktrees,
      targetRelativePath: childTargetRelativePath,
      excludedTargetRootNames,
      signal,
    });
  }
}

export async function createGitOverlayWorkspace({
  sourceTargetPath,
  scratchRoot,
  directoryPrefix,
  purpose,
  excludedTargetRootNames,
  cleanupFailureMode = "await",
  signal,
}: GitOverlayWorkspaceOptions): Promise<GitOverlayWorkspace> {
  const startedAt = Date.now();
  let worktreePath: string | undefined;
  let sourceRepoPath: string | undefined;
  try {
    await fs.mkdir(scratchRoot, { recursive: true });
    const repoResult = await runWorkspaceGit(
      sourceTargetPath,
      ["rev-parse", "--show-toplevel"],
      signal,
    );
    sourceRepoPath = await fs.realpath(repoResult.stdout.trim());
    const realTargetPath = await fs.realpath(sourceTargetPath);
    if (!pathIsInside(sourceRepoPath, realTargetPath)) {
      throw new Error("The target path is outside its Git repository.");
    }
    const targetRelativePath = path.relative(sourceRepoPath, realTargetPath);
    const targetRelativePosix = targetRelativePath.split(path.sep).join("/");

    worktreePath = await fs.mkdtemp(path.join(scratchRoot, directoryPrefix));
    activeWorkspacePaths.add(worktreePath);
    const registeredWorktrees: SubmoduleWorktree[] = [];
    await writeMarker(worktreePath, {
      purpose,
      sourceRepoPath,
      submoduleWorktrees: registeredWorktrees,
    });
    const emptyHooksPath = path.join(scratchRoot, ".empty-hooks");
    await fs.mkdir(emptyHooksPath, { recursive: true });
    await runWorkspaceGit(
      sourceRepoPath,
      [
        "-c",
        `core.hooksPath=${emptyHooksPath}`,
        "worktree",
        "add",
        "--detach",
        worktreePath,
        "HEAD",
      ],
      signal,
    );
    const targetPath = path.join(worktreePath, targetRelativePath);
    // Roots that survived removal because Git tracks them stay in the overlay:
    // excluding them there too would pin the sandbox to their `HEAD` contents
    // and silently drop every live edit beneath them.
    const overlayExcludedRootNames = await removeExcludedTargetRoots(
      sourceRepoPath,
      targetPath,
      targetRelativePosix,
      excludedTargetRootNames,
      signal,
    );
    await removeAlwaysExcludedRoots(sourceRepoPath, worktreePath, signal);
    await overlayWorkspaceState(
      sourceRepoPath,
      worktreePath,
      targetRelativePosix,
      overlayExcludedRootNames,
      signal,
    );
    await materializeInitializedSubmodules({
      sourceRepoPath,
      workspaceRepoPath: worktreePath,
      ownerWorktreePath: worktreePath,
      purpose,
      ownerSourceRepoPath: sourceRepoPath,
      emptyHooksPath,
      registeredWorktrees,
      targetRelativePath: targetRelativePosix,
      excludedTargetRootNames: overlayExcludedRootNames,
      signal,
    });
    await secureGitOverlaySymlinks(sourceRepoPath, worktreePath, signal);
    return {
      targetPath,
      worktreePath,
      setupMs: Date.now() - startedAt,
      sourceTargetPath: realTargetPath,
      sourceRepoPath,
    };
  } catch (error) {
    if (worktreePath) {
      const cleanup = removeGitOverlayWorkspace(worktreePath, sourceRepoPath);
      if (cleanupFailureMode === "background") void cleanup;
      else {
        try {
          await cleanup;
        } catch (cleanupError) {
          logger.warn(
            `Failed to clean a partial Git overlay workspace ${worktreePath}:`,
            cleanupError,
          );
        }
      }
    }
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      `Could not prepare the isolated Git workspace: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.Precondition,
    );
  }
}

export function isGitOverlayWorkspaceActive(worktreePath: string): boolean {
  return activeWorkspacePaths.has(worktreePath);
}

export async function removeGitOverlayWorkspace(
  worktreePath: string,
  sourceRepoPath?: string,
): Promise<void> {
  try {
    const storedMarker = await readGitOverlayWorkspaceMarker(worktreePath);
    const marker = sourceRepoPath
      ? {
          sourceRepoPath,
          submoduleWorktrees: storedMarker?.submoduleWorktrees ?? [],
        }
      : storedMarker;
    // Tracks whether every submodule registration this marker records was
    // actually withdrawn. The marker is the only thing that names them, so
    // deleting it while one is still registered strands that registration in
    // the submodule's Git metadata with nothing left to retry from.
    let allSubmodulesUnregistered = true;
    for (const worktree of [...(marker?.submoduleWorktrees ?? [])].reverse()) {
      try {
        await runWorkspaceGit(
          worktree.sourceRepoPath,
          ["worktree", "remove", "--force", worktree.snapshotPath],
          AbortSignal.timeout(30_000),
        );
      } catch (error) {
        logger.warn(
          `Failed to unregister submodule worktree ${worktree.snapshotPath}:`,
          error,
        );
        try {
          await runWorkspaceGit(
            worktree.sourceRepoPath,
            ["worktree", "prune"],
            AbortSignal.timeout(30_000),
          );
        } catch (pruneError) {
          logger.warn(
            `Failed to prune submodule worktree metadata for ${worktree.sourceRepoPath}:`,
            pruneError,
          );
        }
        // A zero exit from `prune` is not evidence this registration went: it
        // expires worktrees whose directory is MISSING, and the directory still
        // being there is why `remove` failed. Verify rather than assume — the
        // whole point of keeping the marker is that something must still name
        // this registration for a later attempt.
        //
        // Only a definite "it is gone" clears this. A stat that fails for any
        // other reason — EACCES, EIO, a path Windows still has locked — says
        // nothing, and reading it as absence would drop the marker while the
        // registration stands, which is the exact failure this branch exists to
        // prevent.
        const stillPresent = await fs
          .stat(worktree.snapshotPath)
          .then(() => true)
          .catch((error) => !isMissingPathError(error));
        if (stillPresent) allSubmodulesUnregistered = false;
      }
    }
    // The whole workspace stays when a submodule registration outlived this
    // pass — directory AND marker, not the marker alone. The startup sweep
    // enumerates run *directories*, so a marker left beside a deleted directory
    // is never discovered again and the registration is stranded for good.
    // Keeping both means the next launch retries this exact function.
    if (!allSubmodulesUnregistered) {
      logger.warn(
        `Keeping the workspace at ${worktreePath}: a submodule worktree registration could not be removed, and the startup sweep needs it to retry.`,
      );
      return;
    }
    let removedByGit = false;
    if (marker?.sourceRepoPath) {
      try {
        await runWorkspaceGit(
          marker.sourceRepoPath,
          ["worktree", "remove", "--force", worktreePath],
          AbortSignal.timeout(30_000),
        );
        removedByGit = true;
      } catch (error) {
        logger.warn(`Failed to unregister worktree ${worktreePath}:`, error);
      }
    }
    try {
      if (!removedByGit) {
        await fs.rm(worktreePath, {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 100,
        });
      }
      await fs.rm(markerPath(worktreePath), { force: true });
    } catch (error) {
      logger.warn(`Failed to remove workspace ${worktreePath}:`, error);
    }
    if (!removedByGit && marker?.sourceRepoPath) {
      try {
        await runWorkspaceGit(
          marker.sourceRepoPath,
          ["worktree", "prune"],
          AbortSignal.timeout(30_000),
        );
      } catch (error) {
        logger.warn(`Failed to prune stale worktree metadata:`, error);
      }
    }
  } finally {
    activeWorkspacePaths.delete(worktreePath);
  }
}
