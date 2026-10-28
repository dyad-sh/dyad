import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { glob } from "glob";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { readSettings } from "@/main/settings";
import { usesSandboxedE2eTests } from "@/lib/e2eSandbox";
import { TEST_SPEC_GLOB } from "../types/tests";
import { safeJoin } from "../utils/path_utils";
import {
  execGit,
  gitCurrentBranch,
  getCurrentCommitHash,
} from "../utils/git_utils";
import type { TestRunRequest } from "@/test_run_queue/state";

export interface TestRunContext {
  /** Validates the workspace inputs captured at admission. */
  inputFingerprint: string;
  branch?: string;
  revision?: string;
  /** Apps connected to the same remote database also share a conflict domain. */
  databaseKey?: string;
  exclusive: boolean;
}
export type TestRunContextRequest = TestRunRequest & {
  appId: number;
  headed?: boolean;
  parallel?: boolean;
  slowMo?: boolean;
  preview?: boolean;
};

export async function loadTestRunContext(
  request: TestRunContextRequest,
): Promise<TestRunContext> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, request.appId),
  });
  if (!app) throw new Error("App no longer exists");
  const settings = readSettings();
  const appPath = await fs.realpath(getDyadAppPath(app.path));
  const files = (
    request.testFile
      ? [request.testFile]
      : (request.testFiles ??
        (await glob(TEST_SPEC_GLOB, {
          cwd: appPath,
          nodir: true,
          posix: true,
        })))
  )
    .slice()
    .sort();
  const supportFiles = await glob(
    "e2e-tests/**/*.{ts,tsx,js,jsx,mjs,cjs,json}",
    {
      cwd: appPath,
      nodir: true,
      posix: true,
      ignore: [
        "**/node_modules/**",
        "**/test-results/**",
        "**/playwright-report/**",
      ],
    },
  );
  const hash = createHash("sha256");
  const configFiles = [
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "bun.lock",
    "pnpm-workspace.yaml",
    ".npmrc",
    "playwright.config.ts",
    "playwright.config.js",
  ];
  const [root, branchName, commit] = await Promise.all([
    execGit(["rev-parse", "--show-toplevel"], appPath),
    gitCurrentBranch({ path: appPath }),
    getCurrentCommitHash({ path: appPath }),
  ]);
  if (root.exitCode !== 0)
    throw new Error("Unable to identify test repository");
  const repoPath = await fs.realpath(root.stdout.trim());
  // Include ancestor workspace manifests and lockfiles: a member may install
  // from its monorepo root, not from the app directory.
  let directory = path.dirname(appPath);
  while (
    directory !== path.dirname(repoPath) &&
    directory !== path.dirname(directory) &&
    directory.startsWith(repoPath + path.sep)
  ) {
    for (const file of configFiles) {
      const contents = await fs
        .readFile(path.join(directory, file))
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (contents)
        hash
          .update(path.relative(repoPath, directory))
          .update(file)
          .update(contents);
    }
    directory = path.dirname(directory);
  }
  if (repoPath !== appPath)
    for (const file of configFiles) {
      const contents = await fs
        .readFile(path.join(repoPath, file))
        .catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
      if (contents) hash.update(file).update(contents);
    }
  for (const file of [
    ...new Set([...configFiles, ...supportFiles, ...files]),
  ].sort()) {
    const contents = await fs
      .readFile(safeJoin(appPath, file))
      .catch((error) => {
        if (error.code === "ENOENT") return Buffer.from("missing");
        throw error;
      });
    hash.update(file).update(contents);
  }
  const branch = branchName ?? commit.slice(0, 12);
  hash.update(commit).update(branch);
  hash.update(
    JSON.stringify({
      appId: app.id,
      selection: [files, request.testLine, request.grep],
      install: app.installCommand,
      start: app.startCommand,
      runtime: settings.runtimeMode2,
      node: settings.nodeRuntimePreference,
      workers:
        settings.enableParallelTestRuns ||
        app.neonProjectId ||
        app.supabaseProjectId
          ? 1
          : (request.parallel ?? settings.testParallel),
      headed: request.headed ?? settings.testHeaded,
      slowMo: request.slowMo ?? settings.testSlowMo,
      preview:
        !settings.enableParallelTestRuns &&
        (request.preview ?? settings.enableTestRunInPreview),
      sandboxed: usesSandboxedE2eTests(settings),
      provider: [
        app.neonProjectId,
        app.neonActiveBranchId,
        app.neonDevelopmentBranchId,
        app.neonPreviewBranchId,
        app.supabaseProjectId,
      ],
      setup: "reusable-dependencies-v2",
    }),
  );
  const inputFingerprint = hash.digest("hex");
  return {
    inputFingerprint,
    branch,
    revision: commit,
    databaseKey: app.supabaseProjectId
      ? `supabase:${app.supabaseProjectId}`
      : undefined,
    exclusive: !usesSandboxedE2eTests(settings) || !!app.installCommand,
  };
}
