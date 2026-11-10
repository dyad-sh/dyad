import { and, desc, eq, gt, gte } from "drizzle-orm";
import { db } from "@/db";
import { chats, messages } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { blockNewStreamsForChat } from "@/ipc/handlers/chat_stream_handlers";
import {
  execGit,
  getCurrentCommitHash,
  gitCommit,
  inspectRepositoryHealth,
} from "@/ipc/utils/git_utils";
import {
  listCommitsNotIn,
  revertCommitsAsOne,
  stageAllChanges,
} from "@/ipc/utils/git_worktree_utils";
import {
  getStoredTurnOutcomeForMessage,
  type StoredTurnOutcome,
} from "@/ipc/utils/turn_outcome";
import { workspaceRuntimeId } from "../../../shared/workspace_runtime_id";
import { readAppResource } from "./app_operation_coordinator";
import { publishChatInvalidations } from "./chat_actor_platform";
import { chatWorkspaceRegistry } from "./chat_workspace_registry";
import { chatWorkspaceService } from "./chat_workspace_service";
import {
  getActiveWorkspaceForChat,
  getWorkspaceAppPath,
  isWorkspaceIntegrated,
} from "./chat_workspace_store";
import { publishWorkspaceChanged } from "./workspace_events";
import {
  commitInstallChanges,
  workspaceIntegrationQueue,
} from "./workspace_integration_queue";
import { runWorkspaceScopedOperation } from "./workspace_coordination";

/** How the chat's latest turn (from `fromUserMessageId` on) ended. */
async function getLatestTurnOutcome(
  chatId: number,
  fromUserMessageId: number,
): Promise<StoredTurnOutcome> {
  const latestUserMessage = await db.query.messages.findFirst({
    columns: { id: true },
    where: and(
      eq(messages.chatId, chatId),
      eq(messages.role, "user"),
      gte(messages.id, fromUserMessageId),
    ),
    orderBy: desc(messages.id),
  });
  if (!latestUserMessage) return "unknown";
  return getStoredTurnOutcomeForMessage({
    chatId,
    messageId: latestUserMessage.id,
  });
}

/**
 * Undo (and the restore half of Retry) for a chat that works in an isolated
 * workspace.
 *
 * Restoring the whole tree to an older commit would also roll back other
 * chats' work that was merged into this workspace since then, and a commit
 * from the workspace branch must never be restored into the app's original
 * folder. Instead this reverts only the chat's own commits from the undone
 * turns (first-parent, non-merge), as one new commit in the workspace. The
 * merges that brought in other work are left alone, history is never
 * rewritten, and integration then carries the undo into the target branch.
 */
export async function undoIsolatedChatTurns({
  chatId,
  fromUserMessageId,
  requestIntegration: integrateNow = true,
}: {
  chatId: number;
  /** The first user message to remove; it and everything after go. */
  fromUserMessageId: number;
  /**
   * Merge the revert into the target now. Retry passes `false`: the turn it
   * starts next integrates the revert together with its own work.
   */
  requestIntegration?: boolean;
}): Promise<{ undoCommit: string | null }> {
  // Startup recovery may still be reconciling this worktree with Git.
  await chatWorkspaceService.waitForRecovery();
  const workspace = getActiveWorkspaceForChat(chatId);
  if (!workspace) {
    throw new DyadError(
      "This chat doesn't have an isolated workspace",
      DyadErrorKind.NotFound,
    );
  }
  const releaseStreams = blockNewStreamsForChat(chatId);
  try {
    const releaseWorkspace =
      chatWorkspaceRegistry.tryClaimWorkspaceForIntegration(
        workspace.appId,
        workspace.id,
      );
    if (!releaseWorkspace) {
      throw new DyadError(
        "This chat's workspace is busy. Wait for the current response or merge step to finish, then try again.",
        DyadErrorKind.Conflict,
      );
    }
    try {
      return await runWorkspaceScopedOperation(
        {
          appId: workspace.appId,
          workspaceKey: workspaceRuntimeId(workspace.id),
          operation: "undo isolated chat turns",
          appResources: [readAppResource("app-path"), "chat-content"],
          workspaceResources: ["repository"],
        },
        async () => {
          const appPath = getWorkspaceAppPath(workspace);
          const health = await inspectRepositoryHealth({ path: appPath });
          if (health.operationInProgress) {
            throw new DyadError(
              `A Git ${health.operationInProgress} is in progress in this chat's workspace. Finish it before undoing.`,
              DyadErrorKind.Conflict,
            );
          }
          const commits: string[] = [];
          // The workspace's own preview rewrites lockfiles with no turn
          // left to commit them; those are not the chat's work, so keep them
          // (as integration does) rather than reverting them.
          const hasTurnLeftovers =
            !health.isClean && !(await commitInstallChanges(workspace));
          const headBeforeUndo = await getCurrentCommitHash({ path: appPath });
          if (hasTurnLeftovers) {
            // Like Undo in the app's folder, only an interrupted turn's
            // leftovers are undone with it. Any other uncommitted edit (one
            // made in the worktree outside Dyad) is not this chat's turn.
            const outcome = await getLatestTurnOutcome(
              chatId,
              fromUserMessageId,
            );
            if (outcome !== "cancelled" && outcome !== "errored") {
              throw new DyadError(
                "This chat's workspace has uncommitted changes that aren't from an interrupted response. Commit or discard them in the workspace folder, then try again.",
                DyadErrorKind.Conflict,
              );
            }
            // Keep them recoverable in a checkpoint, then undo them with the
            // turn they belong to. Staged from the worktree root: an app in
            // a subfolder can have changes outside it, which the status
            // above counts.
            await stageAllChanges(workspace.path);
            commits.push(
              await gitCommit({
                path: appPath,
                message:
                  "[Interrupted] Saved partial changes before undoing this chat's turn",
              }),
            );
          }
          const undone = await db.query.messages.findMany({
            columns: {
              id: true,
              sourceCommitHash: true,
              commitHash: true,
            },
            where: and(
              eq(messages.chatId, chatId),
              eq(messages.role, "assistant"),
              gt(messages.id, fromUserMessageId),
            ),
            orderBy: desc(messages.id),
          });
          for (const turn of undone) {
            if (!turn.commitHash) continue;
            const own = turn.sourceCommitHash
              ? await listCommitsNotIn({
                  path: appPath,
                  from: turn.commitHash,
                  exclude: turn.sourceCommitHash,
                  firstParent: true,
                  noMerges: true,
                })
              : [turn.commitHash];
            for (const commit of own) {
              if (!commits.includes(commit)) commits.push(commit);
            }
          }
          let undoCommit: string | null;
          try {
            undoCommit = await revertCommitsAsOne({
              worktreePath: appPath,
              commits,
              message: [
                "Undo this chat's latest changes",
                "",
                `Reverts ${commits.length} commit${commits.length === 1 ? "" : "s"} made by this chat; work merged from other chats is kept.`,
                "",
                `Dyad-Chat: ${chatId}`,
                `Dyad-Workspace: ${workspace.branch}`,
              ].join("\n"),
            });
          } catch (error) {
            // Nothing was undone: put the interrupted edits back as they were
            // (uncommitted), so they never get merged as finished work.
            await execGit(["reset", "--mixed", headBeforeUndo], appPath);
            throw error;
          }
          db.transaction((tx) => {
            tx.delete(messages)
              .where(
                and(
                  eq(messages.chatId, chatId),
                  gte(messages.id, fromUserMessageId),
                ),
              )
              .run();
            // As with Undo in the app's folder: the CLI transcript still holds
            // the undone turns, so the next turn starts a fresh session from
            // the remaining visible history.
            tx.update(chats)
              .set({ claudeSessionId: null, claudeSessionState: null })
              .where(
                and(
                  eq(chats.id, chatId),
                  eq(chats.executionBackend, "claude-code"),
                ),
              )
              .run();
          });
          const integrated = await isWorkspaceIntegrated(
            getActiveWorkspaceForChat(chatId) ?? workspace,
          );
          // The undone work may already be in the target; merging the
          // revert carries the undo there too.
          return {
            undoCommit,
            requestIntegration: integrateNow && !integrated,
          };
        },
      ).then(({ undoCommit, requestIntegration }) => {
        if (requestIntegration) {
          // After the workspace claim is released below, the queue picks it up.
          queueMicrotask(() =>
            workspaceIntegrationQueue.dispatch(workspace.id, {
              type: "REQUESTED",
              userInitiated: true,
            }),
          );
        }
        return { undoCommit };
      });
    } finally {
      releaseWorkspace();
    }
  } finally {
    releaseStreams();
    publishChatInvalidations(chatId, workspace.appId);
    publishWorkspaceChanged(workspace.appId);
  }
}
