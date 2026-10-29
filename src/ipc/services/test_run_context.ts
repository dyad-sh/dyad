import { promises as fs } from "node:fs";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { readSettings } from "@/main/settings";
import { usesSandboxedE2eTests } from "@/lib/e2eSandbox";
import { gitCurrentBranch, getCurrentCommitHash } from "../utils/git_utils";
import type { TestRunRequest } from "@/test_run_queue/state";

export interface TestRunContext {
  workspaceKey: string;
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

/** Only inputs that determine whether runs can safely overlap belong here. */
export async function loadTestRunContext(
  request: TestRunContextRequest,
  settings = readSettings(),
): Promise<TestRunContext> {
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, request.appId),
  });
  if (!app) throw new Error("App no longer exists");
  const appPath = await fs.realpath(getDyadAppPath(app.path));
  const [branchName, commit] = await Promise.all([
    gitCurrentBranch({ path: appPath }),
    getCurrentCommitHash({ path: appPath }),
  ]);
  return {
    workspaceKey: appPath,
    branch: branchName ?? commit.slice(0, 12),
    revision: commit,
    databaseKey: app.supabaseProjectId
      ? `supabase:${app.supabaseProjectId}`
      : undefined,
    exclusive: !usesSandboxedE2eTests(settings) || !!app.installCommand,
  };
}
