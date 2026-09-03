import fs from "node:fs/promises";
import path from "node:path";

import log from "electron-log/main";
import { z } from "zod";

import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import {
  appOperationCoordinator,
  readAppResource,
} from "@/ipc/services/app_operation_coordinator";
import {
  copyGitOverlayEntriesOnWindows,
  createGitOverlayWorkspace,
  isGitOverlayWorkspaceActive,
  parseGitOverlayPaths,
  readGitOverlayWorkspaceMarker,
  removeGitOverlayWorkspace,
  secureGitOverlaySymlinks,
} from "@/ipc/services/git_overlay_workspace";
import {
  findPackageManagerRoot,
  getCleanInstallArgs,
  resolvePackageManager,
  runCleanPackageInstall,
} from "@/ipc/services/isolated_package_install";
import {
  detectFrameworkType,
  detectNextJsMajorVersion,
} from "@/ipc/utils/framework_utils";
import { runningApps } from "@/ipc/utils/process_manager";
import { spawnStreaming } from "@/ipc/utils/spawn_streaming";
import { getPackageManagerCommandEnv } from "@/ipc/utils/socket_firewall";
import type { AppFrameworkType } from "@/lib/framework_constants";
import { getUserDataPath } from "@/paths/paths";
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";

const runBuildSchema = z.object({});

const MAX_BUILD_RUNS_PER_TURN = 3;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_OUTPUT_CHARS = 16_000;
const BUILD_OUTPUT_PREVIEW_INTERVAL_MS = 250;
const STALE_SNAPSHOT_AGE_MS = 60 * 60_000;
const SNAPSHOT_PREFIX = ".dyad-build-";
const SNAPSHOT_NAME_PATTERN = /^\.dyad-build-[A-Za-z0-9]{6}$/;
const SNAPSHOT_ROOT_NAME = "build-snapshots";
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

export function selectBuildExecutionMode(
  facts: BuildProjectFacts,
): BuildExecutionMode {
  if (!facts.previewRunning) return "in-place";
  if (facts.hasBuildLifecycleHooks || facts.previewInDocker) return "isolated";
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

export function parseWorkspaceOverlayPaths(
  statusOutput: string,
  appRelativePath = "",
): string[] {
  return parseGitOverlayPaths(
    statusOutput,
    appRelativePath,
    SNAPSHOT_EXCLUDED_NAMES,
  );
}

/**
 * `appRelativePath` is required, not defaulted: it is what anchors the
 * snapshot's root-output exclusions to the app directory. Omitting it silently
 * anchors them at the repository root instead, which drops a repo-root `dist`
 * that has nothing to do with the app being built. Pass `""` when the source
 * root *is* the app root.
 */
export async function copySnapshotEntriesOnWindows(
  sourceRoot: string,
  realSourceRoot: string,
  snapshotRoot: string,
  initialPaths: string[],
  signal: AbortSignal | undefined,
  appRelativePath: string,
): Promise<void> {
  await copyGitOverlayEntriesOnWindows({
    sourceRoot,
    realSourceRoot,
    workspaceRoot: snapshotRoot,
    initialPaths,
    signal,
    targetRelativePath: appRelativePath,
    excludedTargetRootNames: SNAPSHOT_EXCLUDED_NAMES,
  });
}

export async function secureSnapshotSymlinks(
  sourceRoot: string,
  snapshotRoot: string,
  signal?: AbortSignal,
): Promise<void> {
  await secureGitOverlaySymlinks(sourceRoot, snapshotRoot, signal);
}

function getBuildSnapshotRoot(): string {
  return path.join(getUserDataPath(), SNAPSHOT_ROOT_NAME);
}

export async function createBuildWorktree(
  appPath: string,
  snapshotRoot: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const workspace = await createGitOverlayWorkspace({
    sourceTargetPath: appPath,
    scratchRoot: snapshotRoot,
    directoryPrefix: SNAPSHOT_PREFIX,
    purpose: "build",
    excludedTargetRootNames: SNAPSHOT_EXCLUDED_NAMES,
    cleanupFailureMode: "background",
    signal,
  });
  return {
    path: workspace.targetPath,
    worktreePath: workspace.worktreePath,
    setupMs: workspace.setupMs,
    strategy: "git-worktree-overlay",
    sourceAppPath: workspace.sourceTargetPath,
    sourceRepoPath: workspace.sourceRepoPath,
  };
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
            readGitOverlayWorkspaceMarker(snapshotPath),
          ]);
          if (
            stat.isDirectory() &&
            marker?.purpose === "build" &&
            !isGitOverlayWorkspaceActive(snapshotPath) &&
            (options.removeAll || stat.mtimeMs < cutoff)
          ) {
            await removeGitOverlayWorkspace(
              snapshotPath,
              marker.sourceRepoPath,
            );
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
  await removeGitOverlayWorkspace(snapshotPath, sourceRepoPath);
}

export { findPackageManagerRoot, getCleanInstallArgs };

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
- The active preview stays running. Builds that could interfere with it are verified in an isolated workspace with clean dependencies.`,
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
              const resolution = await resolvePackageManager(
                snapshot.sourceAppPath,
                snapshot.sourceRepoPath,
              );
              packageManager = resolution.packageManager;
              const snapshotInstallPath = path.join(
                snapshot.worktreePath,
                path.relative(
                  snapshot.sourceRepoPath,
                  resolution.sourceInstallPath,
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
              const installResult = await runCleanPackageInstall({
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
