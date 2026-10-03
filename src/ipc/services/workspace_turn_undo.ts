import { and, desc, eq, gt, gte } from "drizzle-orm";
import { db } from "@/db";
import { messages } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { blockNewStreamsForChat } from "@/ipc/handlers/chat_stream_handlers";
import {
  getCurrentCommitHash,
  gitCommit,
  inspectRepositoryHealth,
} from "@/ipc/utils/git_utils";
import {
  isAncestorCommit,
  listCommitsNotIn,
  revertCommitsAsOne,
  stageAllChanges,
} from "@/ipc/utils/git_worktree_utils";
import { workspaceRuntimeId } from "../../../shared/workspace_runtime_id";
import { readAppResource } from "./app_operation_coordinator";
import { publishChatInvalidations } from "./chat_actor_platform";
import { chatWorkspaceRegistry } from "./chat_workspace_registry";
import {
  getActiveWorkspaceForChat,
  getWorkspaceAppPath,
  recordIntegrationRequest,
} from "./chat_workspace_store";
import { publishWorkspaceChanged } from "./workspace_events";
import { workspaceIntegrationQueue } from "./workspace_integration_queue";
import { runWorkspaceScopedOperation } from "./workspace_coordination";

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
}: {
  chatId: number;
  /** The first user message to remove; it and everything after go. */
  fromUserMessageId: number;
}): Promise<{ undoCommit: string | null }> {
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
          if (!health.isClean) {
            // An interrupted turn left edits behind. Keep them recoverable
            // in a checkpoint, then undo them with the turn they belong to.
            await stageAllChanges(appPath);
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
          const undoCommit = await revertCommitsAsOne({
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
          await db
            .delete(messages)
            .where(
              and(
                eq(messages.chatId, chatId),
                gte(messages.id, fromUserMessageId),
              ),
            );
          const head = await getCurrentCommitHash({ path: appPath });
          const integrated = await isAncestorCommit({
            path: appPath,
            ancestor: head,
            descendant: `refs/heads/${workspace.targetBranch}`,
          });
          if (!integrated) {
            // The undone work may already be in the target; merging the
            // revert carries the undo there too.
            recordIntegrationRequest({
              appId: workspace.appId,
              chatId,
              messageId: null,
              workspaceBranch: workspace.branch,
              targetBranch: workspace.targetBranch,
              sourceCommitHash: head,
            });
          }
          return { undoCommit, requestIntegration: !integrated };
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
