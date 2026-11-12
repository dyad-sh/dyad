import { eq } from "drizzle-orm";
import { db } from "@/db";
import { apps } from "@/db/schema";
import { readSettings } from "@/main/settings";
import { usesSandboxedE2eTests } from "@/lib/e2eSandbox";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { gitCurrentBranch, getCurrentCommitHash } from "../utils/git_utils";
import { hasCustomE2eStartCommand } from "./e2e_test_runtime";
import type { TestRunRequest } from "@/test_run_queue/state";
import {
  resolveTestRunAppPath,
  type TestRunSourceWorkspace,
} from "./test_run_workspace";

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
  sourceWorkspace?: TestRunSourceWorkspace;
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
  if (!app) throw new DyadError("App no longer exists", DyadErrorKind.NotFound);
  const appPath = await resolveTestRunAppPath(
    app.path,
    request.sourceWorkspace,
  );
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
    exclusive:
      !usesSandboxedE2eTests(settings) || hasCustomE2eStartCommand(app),
  };
}
