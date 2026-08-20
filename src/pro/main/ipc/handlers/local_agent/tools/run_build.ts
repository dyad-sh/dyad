import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import log from "electron-log/main";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";
import { detectNextJsMajorVersion } from "@/ipc/utils/framework_utils";
import { choosePackageManagerForApp } from "@/ipc/utils/package_manager_selection";
import { runningApps } from "@/ipc/utils/process_manager";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import {
  getPackageManagerCommandEnv,
  getPnpmMinimumReleaseAgeSupport,
} from "@/ipc/utils/socket_firewall";
import type { AppFrameworkType } from "@/lib/framework_constants";
import { getUserDataPath } from "@/paths/paths";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";

const runBuildSchema = z.object({});

const MAX_BUILD_RUNS_PER_TURN = 3;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_OUTPUT_CHARS = 16_000;
const STALE_SNAPSHOT_AGE_MS = 60 * 60_000;
const SNAPSHOT_PREFIX = ".dyad-build-";
const SNAPSHOT_NAME_PATTERN = /^\.dyad-build-[A-Za-z0-9]{6}$/;
const SNAPSHOT_MARKER = ".dyad-build-snapshot";
const SNAPSHOT_MARKER_CONTENT = "dyad-build-snapshot-v1";
const SNAPSHOT_ROOT_NAME = "build-snapshots";
const SNAPSHOT_EXCLUDED_NAMES = new Set([
  ".git",
  SNAPSHOT_MARKER,
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
  nextDevOutputIsolated: boolean;
}

/** OS-independent decision: platform only affects how an isolated copy is made. */
export function selectBuildExecutionMode(
  facts: BuildProjectFacts,
): BuildExecutionMode {
  if (!facts.previewRunning) {
    return "in-place";
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
}

interface Snapshot {
  path: string;
  setupMs: number;
  strategy: "macos-clone" | "linux-reflink" | "windows-copy" | "copy";
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

async function gatherBuildProjectFacts(
  ctx: AgentContext,
  buildScript: string,
): Promise<BuildProjectFacts> {
  const previewRunning = runningApps.has(ctx.appId);
  return {
    frameworkType: ctx.frameworkType,
    buildScript,
    nextMajorVersion: detectNextJsMajorVersion(ctx.appPath),
    previewRunning,
    nextDevOutputIsolated:
      !previewRunning ||
      (await fs
        .stat(path.join(ctx.appPath, ".next", "dev"))
        .then((stat) => stat.isDirectory())
        .catch(() => false)),
  };
}

function snapshotStrategy(): Snapshot["strategy"] {
  if (process.platform === "darwin") return "macos-clone";
  if (process.platform === "linux") return "linux-reflink";
  if (process.platform === "win32") return "windows-copy";
  return "copy";
}

async function copySnapshotEntries(
  source: string,
  destination: string,
  entries: string[],
  signal?: AbortSignal,
): Promise<void> {
  if (process.platform === "darwin" && entries.length > 0) {
    const result = await spawnStreaming({
      command: "/bin/cp",
      args: [
        "-cR",
        ...entries.map((entry) => path.join(source, entry)),
        destination,
      ],
      cwd: source,
      signal,
    });
    if (result.code === 0 && !result.aborted && !result.timedOut) return;
    if (result.aborted) {
      throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
    }
    // clonefile can fail for a destination on another filesystem. Retry with
    // Node's portable copy before treating snapshot setup as unavailable.
  }

  const realSource =
    process.platform === "win32" ? await fs.realpath(source) : source;
  await Promise.all(
    entries.map((entry) =>
      process.platform === "win32"
        ? copySnapshotEntryOnWindows(
            source,
            realSource,
            destination,
            path.join(source, entry),
            signal,
          )
        : fs.cp(path.join(source, entry), path.join(destination, entry), {
            recursive: true,
            verbatimSymlinks: true,
            mode:
              process.platform === "linux" ? fsConstants.COPYFILE_FICLONE : 0,
            filter: () => !signal?.aborted,
          }),
    ),
  );

  if (signal?.aborted) {
    throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
  }
}

function throwIfBuildCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
  }
}

async function copySnapshotEntryOnWindows(
  sourceRoot: string,
  realSourceRoot: string,
  snapshotRoot: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<void> {
  throwIfBuildCancelled(signal);
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
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    const targetStat = await fs.stat(realTarget);
    const mappedTarget = path.join(
      snapshotRoot,
      path.relative(realSourceRoot, realTarget),
    );
    if (!targetStat.isDirectory()) {
      await fs.copyFile(realTarget, destinationPath);
      return;
    }
    await fs.symlink(mappedTarget, destinationPath, "junction");
    return;
  }
  if (stat.isDirectory()) {
    await fs.mkdir(destinationPath, { recursive: true });
    const children = await fs.readdir(sourcePath);
    await Promise.all(
      children.map((child) =>
        copySnapshotEntryOnWindows(
          sourceRoot,
          realSourceRoot,
          snapshotRoot,
          path.join(sourcePath, child),
          signal,
        ),
      ),
    );
    return;
  }
  await fs.copyFile(sourcePath, destinationPath);
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
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      const entryStat = await fs.lstat(entryPath);
      if (!entryStat.isSymbolicLink()) {
        if (entryStat.isDirectory()) pendingDirectories.push(entryPath);
        continue;
      }

      let realTarget: string;
      try {
        realTarget = await fs.realpath(entryPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          await fs.unlink(entryPath);
          continue;
        }
        throw new DyadError(
          `Cannot isolate the linked path ${path.relative(snapshotRoot, entryPath)} because its target is unavailable.`,
          DyadErrorKind.Precondition,
        );
      }
      if (pathIsInside(realSnapshotRoot, realTarget)) continue;
      if (!pathIsInside(realSourceRoot, realTarget)) {
        throw new DyadError(
          `Cannot isolate the linked path ${path.relative(snapshotRoot, entryPath)} because it points outside the app. Replace the external link with a local dependency before running a production build.`,
          DyadErrorKind.Precondition,
        );
      }

      const mappedTarget = path.join(
        realSnapshotRoot,
        path.relative(realSourceRoot, realTarget),
      );
      const realEntryPath = path.join(
        realSnapshotRoot,
        path.relative(snapshotRoot, entryPath),
      );
      const targetStat = await fs.stat(realTarget);
      await fs.rm(entryPath, {
        force: true,
        recursive: targetStat.isDirectory(),
      });
      const linkTarget =
        process.platform === "win32" && targetStat.isDirectory()
          ? mappedTarget
          : path.relative(path.dirname(realEntryPath), mappedTarget) || ".";
      await fs.symlink(
        linkTarget,
        entryPath,
        targetStat.isDirectory()
          ? process.platform === "win32"
            ? "junction"
            : "dir"
          : "file",
      );
    }
  }
}

async function validateSourceLinks(
  sourceRoot: string,
  rootEntries: string[],
  signal?: AbortSignal,
): Promise<void> {
  const realSourceRoot = await fs.realpath(sourceRoot);
  const pendingDirectories = rootEntries.map((entry) =>
    path.join(sourceRoot, entry),
  );
  while (pendingDirectories.length > 0) {
    throwIfBuildCancelled(signal);
    const entryPath = pendingDirectories.pop();
    if (!entryPath) break;
    const stat = await fs.lstat(entryPath);
    if (!stat.isSymbolicLink()) {
      if (stat.isDirectory()) {
        const children = await fs.readdir(entryPath);
        pendingDirectories.push(
          ...children.map((child) => path.join(entryPath, child)),
        );
      }
      continue;
    }
    let realTarget: string;
    try {
      realTarget = await fs.realpath(entryPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    if (!pathIsInside(realSourceRoot, realTarget)) {
      throw new DyadError(
        `Cannot isolate the linked path ${path.relative(sourceRoot, entryPath)} because it points outside the app. Replace the external link with a local dependency before running a production build.`,
        DyadErrorKind.Precondition,
      );
    }
  }
}

function getBuildSnapshotRoot(): string {
  return path.join(getUserDataPath(), SNAPSHOT_ROOT_NAME);
}

async function createSnapshot(
  appPath: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const startedAt = Date.now();
  let tempRoot: string | undefined;
  try {
    const snapshotRoot = getBuildSnapshotRoot();
    await fs.mkdir(snapshotRoot, { recursive: true });
    await removeStaleSnapshots(snapshotRoot);

    const nodeModulesStat = await fs
      .stat(path.join(appPath, "node_modules"))
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
    if (!nodeModulesStat?.isDirectory()) {
      throw new DyadError(
        "Dependencies are missing or incomplete. Reinstall dependencies and restart the app, then retry the build.",
        DyadErrorKind.Precondition,
      );
    }

    const entries = (await fs.readdir(appPath)).filter(
      (entry) => !SNAPSHOT_EXCLUDED_NAMES.has(entry),
    );
    await validateSourceLinks(appPath, entries, signal);
    tempRoot = await fs.mkdtemp(path.join(snapshotRoot, SNAPSHOT_PREFIX));
    await fs.writeFile(
      path.join(tempRoot, SNAPSHOT_MARKER),
      SNAPSHOT_MARKER_CONTENT,
      "utf8",
    );
    await copySnapshotEntries(appPath, tempRoot, entries, signal);
    await secureSnapshotSymlinks(appPath, tempRoot, signal);
    return {
      path: tempRoot,
      setupMs: Date.now() - startedAt,
      strategy: snapshotStrategy(),
    };
  } catch (error) {
    if (tempRoot) await removeSnapshot(tempRoot);
    if (error instanceof DyadError) throw error;
    throw new DyadError(
      `Could not prepare the isolated build workspace: ${error instanceof Error ? error.message : String(error)}`,
      DyadErrorKind.Precondition,
    );
  }
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
            fs
              .readFile(path.join(snapshotPath, SNAPSHOT_MARKER), "utf8")
              .catch(() => null),
          ]);
          if (
            stat.isDirectory() &&
            marker === SNAPSHOT_MARKER_CONTENT &&
            (options.removeAll || stat.mtimeMs < cutoff)
          ) {
            await removeSnapshot(snapshotPath);
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

async function removeSnapshot(snapshotPath: string): Promise<void> {
  try {
    await fs.rm(snapshotPath, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  } catch (error) {
    logger.warn(`Failed to remove build snapshot ${snapshotPath}:`, error);
  }
}

function tail(value: string): string {
  return value.length <= MAX_RESULT_OUTPUT_CHARS
    ? value
    : `[Earlier output omitted]\n${value.slice(-MAX_RESULT_OUTPUT_CHARS)}`;
}

async function resolvePackageManager(appPath: string) {
  const support = await getPnpmMinimumReleaseAgeSupport();
  return choosePackageManagerForApp(appPath, support.available);
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

function streamBuildOutput(ctx: AgentContext, chunk: string): void {
  const output = tail(chunk.trim());
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
- The preview is never stopped. Standard Vite and preview-safe Next.js 16+ builds run in place. Unknown concurrent builds use an isolated workspace snapshot while a preview is running.`,
  inputSchema: runBuildSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: () =>
    "Runs the app's current package.json build lifecycle (prebuild, build, and postbuild). This executes project and dependency code with your user account. A workspace snapshot protects the live preview from ordinary build output, but is not a security sandbox.",

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

          const packageJson = await readPackageJson(ctx.appPath);
          const buildScript = getScript(packageJson, "build");
          if (!buildScript) {
            throw new DyadError(
              "This app does not define a package.json scripts.build command, so production build verification is unavailable.",
              DyadErrorKind.Precondition,
            );
          }
          const facts = await gatherBuildProjectFacts(ctx, buildScript);
          const mode = selectBuildExecutionMode(facts);

          ctx.onXmlStream(
            `<dyad-status title="${escapeXmlAttr(mode === "in-place" ? "Building beside preview" : "Preparing isolated build")}"></dyad-status>`,
          );
          const abortScope = createBuildAbortScope(ctx.abortSignal);
          const operationStartedAt = Date.now();
          let snapshot: Snapshot | undefined;
          try {
            if (mode === "isolated") {
              snapshot = await createSnapshot(ctx.appPath, abortScope.signal);
            }
            const packageManager = await resolvePackageManager(ctx.appPath);
            state.count += 1;
            state.mutationCountAtLastRun = currentMutationCount;
            ctx.onXmlStream(
              '<dyad-status title="Running production build"></dyad-status>',
            );
            const buildStartedAt = Date.now();
            const result = await runBuildProcess({
              cwd: snapshot?.path ?? ctx.appPath,
              packageManager,
              signal: abortScope.signal,
              timeoutMs: Math.max(1, abortScope.deadlineAt - Date.now()),
              onOutput: (chunk) => streamBuildOutput(ctx, chunk),
            });
            const buildMs = Date.now() - buildStartedAt;
            const timing = snapshot
              ? `Mode: isolated (${snapshot.strategy}); snapshot setup: ${snapshot.setupMs} ms; build: ${buildMs} ms.`
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
            if (abortScope.timedOut()) {
              const elapsedMs = Date.now() - operationStartedAt;
              const body = `Production build timed out after 10 minutes during ${snapshot ? "the build" : "snapshot setup"}. Elapsed: ${elapsedMs} ms.`;
              completeStatus(ctx, "Build timed out", body, "warning");
              return body;
            }
            throw error;
          } finally {
            abortScope.dispose();
            if (snapshot) {
              await removeSnapshot(snapshot.path);
            }
          }
        },
      );
    } finally {
      activeBuilds.delete(ctx.appId);
    }
  },
};
