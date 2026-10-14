import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import {
  chatWorkspaces,
  workspaceIntegrations,
  type WorkspaceValidationCheck,
} from "@/db/schema";
import { getUserDataPath } from "@/paths/paths";
import {
  IDLE_INTEGRATION_STATE,
  type IntegrationState,
} from "@/workspace_integration/state";

export type ChatWorkspaceRow = typeof chatWorkspaces.$inferSelect;
export type WorkspaceIntegrationRow = typeof workspaceIntegrations.$inferSelect;

/** Dyad-owned root for chat worktrees; never inside an app directory. */
export function getChatWorkspacesRoot(): string {
  return path.join(getUserDataPath(), "chat-workspaces");
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

export function countLiveWorkspacesForApp(appId: number): number {
  return db
    .select({ id: chatWorkspaces.id })
    .from(chatWorkspaces)
    .where(
      and(
        eq(chatWorkspaces.appId, appId),
        ne(chatWorkspaces.status, "removing"),
      ),
    )
    .all().length;
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
  return db
    .insert(chatWorkspaces)
    .values({ ...input, status: "creating" })
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

/** Per-turn integration history ------------------------------------------ */

export function recordIntegrationRequest(input: {
  appId: number;
  chatId: number;
  messageId: number | null;
  workspaceBranch: string;
  targetBranch: string;
  sourceCommitHash: string;
}): WorkspaceIntegrationRow {
  return db
    .insert(workspaceIntegrations)
    .values({ ...input, status: "queued" })
    .returning()
    .get();
}

const OPEN_INTEGRATION_STATUSES = [
  "queued",
  "merging",
  "resolving-conflicts",
  "validating",
  "integrating",
  "paused",
  "failed",
] as const;

/** Records that have not reached a terminal outcome for this chat. */
export function listOpenIntegrations(
  chatId: number,
): WorkspaceIntegrationRow[] {
  return db
    .select()
    .from(workspaceIntegrations)
    .where(
      and(
        eq(workspaceIntegrations.chatId, chatId),
        inArray(workspaceIntegrations.status, [...OPEN_INTEGRATION_STATUSES]),
      ),
    )
    .all();
}

export function updateOpenIntegrations(
  chatId: number,
  values: Partial<
    Pick<
      WorkspaceIntegrationRow,
      | "status"
      | "targetCommitHash"
      | "mergeCommitHash"
      | "integratedCommitHash"
      | "validationJson"
      | "detail"
    >
  >,
): void {
  db.update(workspaceIntegrations)
    .set({ ...values, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceIntegrations.chatId, chatId),
        inArray(workspaceIntegrations.status, [...OPEN_INTEGRATION_STATUSES]),
      ),
    )
    .run();
}

/**
 * Follows a branch rename in an app's repository. Renaming a target branch
 * is not switching to another one, so its workspaces keep targeting it under
 * the new name; a renamed workspace branch stays that workspace's branch.
 * Finished integration records keep the names they were made with.
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
  const open = inArray(workspaceIntegrations.status, [
    ...OPEN_INTEGRATION_STATUSES,
  ]);
  db.update(workspaceIntegrations)
    .set({ targetBranch: newBranch, updatedAt })
    .where(
      and(
        eq(workspaceIntegrations.appId, appId),
        eq(workspaceIntegrations.targetBranch, oldBranch),
        open,
      ),
    )
    .run();
  db.update(workspaceIntegrations)
    .set({ workspaceBranch: newBranch, updatedAt })
    .where(
      and(
        eq(workspaceIntegrations.appId, appId),
        eq(workspaceIntegrations.workspaceBranch, oldBranch),
        open,
      ),
    )
    .run();
  return changes > 0;
}

export function listIntegrationsForChat(
  chatId: number,
  limit = 50,
): WorkspaceIntegrationRow[] {
  return db
    .select()
    .from(workspaceIntegrations)
    .where(eq(workspaceIntegrations.chatId, chatId))
    .orderBy(desc(workspaceIntegrations.id))
    .limit(limit)
    .all();
}

export function latestIntegrationForMessage(
  messageId: number,
): WorkspaceIntegrationRow | undefined {
  return db
    .select()
    .from(workspaceIntegrations)
    .where(eq(workspaceIntegrations.messageId, messageId))
    .orderBy(desc(workspaceIntegrations.id))
    .limit(1)
    .get();
}

export function summarizeValidation(
  checks: readonly WorkspaceValidationCheck[] | null | undefined,
): string {
  if (!checks || checks.length === 0) return "No checks ran.";
  return checks.map((check) => `${check.name}: ${check.outcome}`).join(", ");
}
