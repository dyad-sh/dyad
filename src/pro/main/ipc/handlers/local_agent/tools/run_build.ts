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
import type { AgentContext, ToolDefinition } from "./types";
import { escapeXmlAttr, escapeXmlContent } from "./types";

const runBuildSchema = z.object({
  expected_prebuild_script: z
    .string()
    .nullable()
    .describe(
      "The exact current value of package.json scripts.prebuild, or null when it is absent. Read package.json first and copy it verbatim.",
    ),
  expected_build_script: z
    .string()
    .min(1)
    .describe(
      "The exact current value of package.json scripts.build. Read package.json first and copy the value verbatim. The build is rejected if it changed before execution.",
    ),
  expected_postbuild_script: z
    .string()
    .nullable()
    .describe(
      "The exact current value of package.json scripts.postbuild, or null when it is absent. Read package.json first and copy it verbatim.",
    ),
});

const MAX_BUILD_RUNS_PER_TURN = 3;
const BUILD_TIMEOUT_MS = 10 * 60_000;
const MAX_RESULT_OUTPUT_CHARS = 16_000;
const STALE_SNAPSHOT_AGE_MS = 60 * 60_000;
const SNAPSHOT_PREFIX = ".dyad-build-";
const SNAPSHOT_NAME_PATTERN = /^\.dyad-build-[A-Za-z0-9]{6}$/;
const SNAPSHOT_EXCLUDED_NAMES = new Set([
  ".git",
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

  await Promise.all(
    entries.map(async (entry) => {
      if (signal?.aborted) {
        throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
      }
      await fs.cp(path.join(source, entry), path.join(destination, entry), {
        recursive: true,
        verbatimSymlinks: true,
        mode: process.platform === "linux" ? fsConstants.COPYFILE_FICLONE : 0,
        filter: () => !signal?.aborted,
      });
    }),
  );

  if (signal?.aborted) {
    throw new DyadError("Build cancelled.", DyadErrorKind.UserCancelled);
  }
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
): Promise<void> {
  const [realSourceRoot, realSnapshotRoot] = await Promise.all([
    fs.realpath(sourceRoot),
    fs.realpath(snapshotRoot),
  ]);
  const pendingDirectories = [snapshotRoot];
  while (pendingDirectories.length > 0) {
    const directory = pendingDirectories.pop();
    if (!directory) break;
    const entries = await fs.readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
        continue;
      }
      if (!entry.isSymbolicLink()) continue;

      let realTarget: string;
      try {
        realTarget = await fs.realpath(entryPath);
      } catch {
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

async function createSnapshot(
  appPath: string,
  signal?: AbortSignal,
): Promise<Snapshot> {
  const startedAt = Date.now();
  let tempRoot: string | undefined;
  try {
    const parentPath = path.dirname(appPath);
    await removeStaleSnapshots(parentPath);

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

    tempRoot = await fs.mkdtemp(path.join(parentPath, SNAPSHOT_PREFIX));
    const entries = (await fs.readdir(appPath)).filter(
      (entry) => !SNAPSHOT_EXCLUDED_NAMES.has(entry),
    );
    await copySnapshotEntries(appPath, tempRoot, entries, signal);
    await secureSnapshotSymlinks(appPath, tempRoot);
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

async function removeStaleSnapshots(parentPath: string): Promise<void> {
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
          const stat = await fs.lstat(snapshotPath);
          if (stat.isDirectory() && stat.mtimeMs < cutoff) {
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

function normalizeExpectedScript(value: string | null): string | null {
  return value === null ? null : value.trim();
}

async function resolvePackageManager(appPath: string) {
  const support = await getPnpmMinimumReleaseAgeSupport();
  return choosePackageManagerForApp(appPath, support.available);
}

async function runBuildProcess({
  cwd,
  packageManager,
  signal,
}: {
  cwd: string;
  packageManager: "npm" | "pnpm";
  signal?: AbortSignal;
}) {
  return spawnStreaming({
    command: packageManager,
    args: ["run", "build"],
    cwd,
    env: getPackageManagerCommandEnv(),
    signal,
    timeoutMs: BUILD_TIMEOUT_MS,
  });
}

export const runBuildTool: ToolDefinition<z.infer<typeof runBuildSchema>> = {
  name: "run_build",
  description: `Run the app's production build as a selective, expensive verification step.

- Read package.json first and pass scripts.prebuild, scripts.build, and scripts.postbuild exactly (using null for absent lifecycle hooks) so the complete command lifecycle can be revalidated before execution.
- Use after build configuration, dependencies, framework routing, server/static-generation, environment loading, or substantial production-path changes, or when the user explicitly asks.
- Do not use after routine small UI, styling, copy, or asset edits. Type checking is the normal verification step.
- Finish related edits first and run once. A failed build may be retried only after making a relevant change.
- The preview is never stopped. Standard Vite and preview-safe Next.js 16+ builds run in place. Unknown concurrent builds use an isolated workspace snapshot while a preview is running.`,
  inputSchema: runBuildSchema,
  defaultConsent: "always",
  modifiesState: true,

  getConsentPreview: (args) =>
    [
      `prebuild: ${args.expected_prebuild_script ?? "(none)"}`,
      `build: ${args.expected_build_script}`,
      `postbuild: ${args.expected_postbuild_script ?? "(none)"}`,
      "This executes project and dependency code with your user account. A workspace snapshot protects the live preview from ordinary build output, but is not a security sandbox.",
    ].join("\n"),

  buildXml: (_args, isComplete) =>
    isComplete
      ? undefined
      : '<dyad-status title="Running production build"></dyad-status>',

  execute: async (args, ctx) => {
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
          const prebuildScript = getScript(packageJson, "prebuild");
          const postbuildScript = getScript(packageJson, "postbuild");
          if (
            buildScript !== args.expected_build_script.trim() ||
            prebuildScript !==
              normalizeExpectedScript(args.expected_prebuild_script) ||
            postbuildScript !==
              normalizeExpectedScript(args.expected_postbuild_script)
          ) {
            throw new DyadError(
              "The package.json build lifecycle changed or did not match the approved commands. Read package.json again and retry with the exact current values.",
              DyadErrorKind.Conflict,
            );
          }
          const facts = await gatherBuildProjectFacts(ctx, buildScript);
          const mode = selectBuildExecutionMode(facts);

          state.count += 1;
          state.mutationCountAtLastRun = currentMutationCount;
          ctx.onXmlStream(
            `<dyad-status title="${escapeXmlAttr(mode === "in-place" ? "Building beside preview" : "Preparing isolated build")}"></dyad-status>`,
          );
          let snapshot: Snapshot | undefined;
          try {
            if (mode === "isolated") {
              snapshot = await createSnapshot(ctx.appPath, ctx.abortSignal);
            }
            const packageManager = await resolvePackageManager(ctx.appPath);
            const buildStartedAt = Date.now();
            const result = await runBuildProcess({
              cwd: snapshot?.path ?? ctx.appPath,
              packageManager,
              signal: ctx.abortSignal,
            });
            const buildMs = Date.now() - buildStartedAt;
            const timing = snapshot
              ? `Mode: isolated (${snapshot.strategy}); snapshot setup: ${snapshot.setupMs} ms; build: ${buildMs} ms.`
              : `Mode: in-place; build: ${buildMs} ms.`;
            const output = tail(
              [result.stdout, result.stderr].filter(Boolean).join("\n"),
            );

            if (result.aborted) {
              throw new DyadError(
                "Build cancelled.",
                DyadErrorKind.UserCancelled,
              );
            }
            if (result.timedOut) {
              const body = `Production build timed out after 10 minutes. ${timing}\n\n${output}`;
              completeStatus(ctx, "Build timed out", body, "warning");
              return body;
            }
            if (result.code !== 0) {
              const body = `Production build failed with exit code ${result.code}. ${timing}\n\n${output}`;
              completeStatus(ctx, "Build failed", body, "warning");
              return body;
            }

            const body = `Production build passed. ${timing}${output ? `\n\n${output}` : ""}`;
            completeStatus(ctx, "Build passed", body);
            return body;
          } finally {
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
