import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  apps,
  chatWorkspaces,
  type WorkspaceValidationCheck,
} from "@/db/schema";
import { getDyadAppPath } from "@/paths/paths";
import { workspacePortSlotCount } from "../../../shared/ports";
import { getChatWorkspacesRoot } from "@/paths/chat_workspaces";
import { getCurrentCommitHash } from "@/ipc/utils/git_utils";
import {
  IDLE_INTEGRATION_STATE,
  type IntegrationState,
} from "@/workspace_integration/state";

export type ChatWorkspaceRow = typeof chatWorkspaces.$inferSelect;

export { getChatWorkspacesRoot };

/** The app's own folder (where its main branch is checked out). */
export async function getOriginalAppPath(
  appId: number,
): Promise<string | null> {
  const app = await db.query.apps.findFirst({
    columns: { path: true },
    where: eq(apps.id, appId),
  });
  return app ? getDyadAppPath(app.path) : null;
}

/**
 * The id for a new workspace. Its preview ports come from the id modulo the
 * workspace port band, and workspaces are kept until the user deletes them,
 * so the id skips any slot a live workspace holds. Ids only grow (never
 * reused), and once every slot is taken the next id is used as is.
 */
export function pickWorkspaceId({
  lastId,
  usedIds,
  slots,
}: {
  lastId: number;
  usedIds: readonly number[];
  slots: number;
}): number {
  const taken = new Set(usedIds.map((id) => id % slots));
  let candidate = lastId + 1;
  if (taken.size >= slots) return candidate;
  while (taken.has(candidate % slots)) candidate++;
  return candidate;
}

function lastWorkspaceId(): number {
  try {
    const row = db.get<{ seq: number } | undefined>(
      sql`SELECT seq FROM sqlite_sequence WHERE name = 'chat_workspaces'`,
    );
    if (row) return row.seq;
  } catch {
    // No sqlite_sequence row yet: fall back to the rows themselves.
  }
  return Math.max(
    0,
    ...db
      .select({ id: chatWorkspaces.id })
      .from(chatWorkspaces)
      .all()
      .map((row) => row.id),
  );
}

export function buildWorkspaceRootPath(appId: number, chatId: number): string {
  const suffix = crypto.randomBytes(3).toString("hex");
  return path.join(
    getChatWorkspacesRoot(),
    `app-${appId}`,
    `chat-${chatId}-${suffix}`,
  );
}

/** Directory the app occupies inside a workspace. */
export function getWorkspaceAppPath(
  workspace: Pick<ChatWorkspaceRow, "path" | "appSubpath">,
): string {
  return workspace.appSubpath
    ? path.join(workspace.path, workspace.appSubpath)
    : workspace.path;
}

/**
 * The workspace commit whose content its target already has: recorded at each
 * successful fast-forward (and each synchronization of an integrated
 * workspace); the base commit before the first.
 */
export function integratedHead(
  workspace: Pick<ChatWorkspaceRow, "lastIntegratedCommit" | "baseCommit">,
): string {
  return workspace.lastIntegratedCommit ?? workspace.baseCommit;
}

/**
 * Whether everything in the workspace is already in its target: its HEAD has
 * not moved since the last successful fast-forward. Work reaches the target as
 * one squash commit, so this never looks for the workspace's own commits in
 * the target's history.
 */
export async function isWorkspaceIntegrated(
  workspace: ChatWorkspaceRow,
): Promise<boolean> {
  const head = await getCurrentCommitHash({
    path: getWorkspaceAppPath(workspace),
  });
  return head === integratedHead(workspace);
}

/**
 * A path Git reports (relative to the repository root) as the agent's tools
 * address it: relative to the app's folder inside the workspace. They differ
 * when the app lives in a subfolder of its repository.
 */
export function toAppRelativePath(
  workspace: Pick<ChatWorkspaceRow, "appSubpath">,
  repositoryRelativePath: string,
): string {
  if (!workspace.appSubpath) return repositoryRelativePath;
  return path.posix.relative(
    workspace.appSubpath.split(path.sep).join("/"),
    repositoryRelativePath,
  );
}

export function getWorkspaceForChat(
  chatId: number,
): ChatWorkspaceRow | undefined {
  return db
    .select()
    .from(chatWorkspaces)
    .where(eq(chatWorkspaces.chatId, chatId))
    .get();
}

/** The chat's workspace when it is usable right now (active, on disk). */
export function getActiveWorkspaceForChat(
  chatId: number,
): ChatWorkspaceRow | undefined {
  const workspace = getWorkspaceForChat(chatId);
  return workspace?.status === "active" &&
    fs.existsSync(getWorkspaceAppPath(workspace))
    ? workspace
    : undefined;
}

export function getWorkspaceById(
  workspaceId: number,
): ChatWorkspaceRow | undefined {
  return db
    .select()
    .from(chatWorkspaces)
    .where(eq(chatWorkspaces.id, workspaceId))
    .get();
}

export function listWorkspacesForApp(appId: number): ChatWorkspaceRow[] {
  return db
    .select()
    .from(chatWorkspaces)
    .where(eq(chatWorkspaces.appId, appId))
    .all();
}

export function listAllWorkspaces(): ChatWorkspaceRow[] {
  return db.select().from(chatWorkspaces).all();
}

export function insertWorkspace(input: {
  appId: number;
  chatId: number;
  path: string;
  appSubpath: string;
  branch: string;
  targetBranch: string;
  baseCommit: string;
}): ChatWorkspaceRow {
  const id = pickWorkspaceId({
    lastId: lastWorkspaceId(),
    usedIds: db
      .select({ id: chatWorkspaces.id })
      .from(chatWorkspaces)
      .all()
      .map((row) => row.id),
    slots: workspacePortSlotCount(),
  });
  return db
    .insert(chatWorkspaces)
    .values({ ...input, id, status: "creating" })
    .returning()
    .get();
}

export function updateWorkspace(
  workspaceId: number,
  values: Partial<
    Pick<
      ChatWorkspaceRow,
      | "status"
      | "lastActiveAt"
      | "lastIntegratedCommit"
      | "validationJson"
      | "integrationStatus"
      | "integrationDetail"
      | "integrationTargetCommit"
      | "repairAttempts"
      | "packageManager"
    >
  >,
): void {
  db.update(chatWorkspaces)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(chatWorkspaces.id, workspaceId))
    .run();
}

export function touchWorkspace(workspaceId: number): void {
  updateWorkspace(workspaceId, { lastActiveAt: new Date() });
}

export function deleteWorkspaceRow(workspaceId: number): void {
  db.delete(chatWorkspaces).where(eq(chatWorkspaces.id, workspaceId)).run();
}

export function readIntegrationState(
  workspace: ChatWorkspaceRow,
): IntegrationState {
  return {
    ...IDLE_INTEGRATION_STATE,
    phase: workspace.integrationStatus,
    detail: workspace.integrationDetail,
    targetCommit: workspace.integrationTargetCommit,
    repairAttempts: workspace.repairAttempts,
  };
}

export function writeIntegrationState(
  workspaceId: number,
  state: IntegrationState,
): void {
  updateWorkspace(workspaceId, {
    integrationStatus: state.phase,
    integrationDetail: state.detail,
    integrationTargetCommit: state.targetCommit,
    repairAttempts: state.repairAttempts,
  });
}

/**
 * Follows a branch rename in an app's repository. Renaming a target branch
 * is not switching to another one, so its workspaces keep targeting it under
 * the new name; a renamed workspace branch stays that workspace's branch.
 */
export function renameBranchReferences({
  appId,
  oldBranch,
  newBranch,
}: {
  appId: number;
  oldBranch: string;
  newBranch: string;
}): boolean {
  const updatedAt = new Date();
  let changes = 0;
  changes += db
    .update(chatWorkspaces)
    .set({ targetBranch: newBranch, updatedAt })
    .where(
      and(
        eq(chatWorkspaces.appId, appId),
        eq(chatWorkspaces.targetBranch, oldBranch),
      ),
    )
    .run().changes;
  changes += db
    .update(chatWorkspaces)
    .set({ branch: newBranch, updatedAt })
    .where(
      and(
        eq(chatWorkspaces.appId, appId),
        eq(chatWorkspaces.branch, oldBranch),
      ),
    )
    .run().changes;
  return changes > 0;
}

export function summarizeValidation(
  checks: readonly WorkspaceValidationCheck[] | null | undefined,
): string {
  if (!checks || checks.length === 0) return "No checks ran.";
  return checks.map((check) => `${check.name}: ${check.outcome}`).join(", ");
}
