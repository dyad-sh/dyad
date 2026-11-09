import { eq } from "drizzle-orm";
import { db } from "@/db";
import { chats } from "@/db/schema";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "@/paths/paths";
import { gitCurrentBranch } from "@/ipc/utils/git_utils";
import { chatWorkspaceRegistry } from "@/ipc/services/chat_workspace_registry";
import {
  chatWorkspaceService,
  isWorktreeIsolationEnabled,
} from "@/ipc/services/chat_workspace_service";
import {
  getActiveWorkspaceForChat,
  isWorkspaceIntegrated,
  listWorkspacesForApp,
  readIntegrationState,
  type ChatWorkspaceRow,
} from "@/ipc/services/chat_workspace_store";
import { listUncommittedPaths } from "@/ipc/utils/git_worktree_utils";
import { undoIsolatedChatTurns } from "@/ipc/services/workspace_turn_undo";
import { selectIntegrationCapabilities } from "@/workspace_integration/state";
import { workspaceRuntimeId } from "../../../shared/workspace_runtime_id";
import { workspaceContracts } from "../types/workspace";
import { createTypedHandler } from "./base";

/** Errs toward "yes", so the delete dialog warns when Git can't tell. */
async function hasUnmergedWork(workspace: ChatWorkspaceRow): Promise<boolean> {
  try {
    if (!(await isWorkspaceIntegrated(workspace))) return true;
    return (await listUncommittedPaths(workspace.path)).length > 0;
  } catch {
    return true;
  }
}

export function registerWorkspaceHandlers() {
  createTypedHandler(
    workspaceContracts.getChatWorkspaceStatus,
    async (_, { chatId }) => {
      const chat = await db.query.chats.findFirst({
        columns: { id: true, appId: true },
        where: eq(chats.id, chatId),
        with: { app: { columns: { path: true } } },
      });
      if (!chat) {
        throw new DyadError("Chat not found", DyadErrorKind.NotFound);
      }
      const writableTurnRunning = chatWorkspaceRegistry
        .getWritableChatIds(chat.appId)
        .includes(chatId);
      const workspace = getActiveWorkspaceForChat(chatId);
      if (workspace) {
        const state = readIntegrationState(workspace);
        return {
          chatId,
          appId: chat.appId,
          kind: "isolated" as const,
          branch: workspace.branch,
          targetBranch: workspace.targetBranch,
          workspaceId: workspace.id,
          runtimeAppId: workspaceRuntimeId(workspace.id),
          writableTurnRunning,
          packageManager: workspace.packageManager,
          hasUnmergedWork: await hasUnmergedWork(workspace),
          integration: {
            phase: workspace.integrationStatus,
            detail: workspace.integrationDetail,
            validation: workspace.validationJson,
            canRetry: selectIntegrationCapabilities(state).canRetry,
          },
        };
      }
      const branch = await gitCurrentBranch({
        path: getDyadAppPath(chat.app.path),
      }).catch(() => null);
      return {
        chatId,
        appId: chat.appId,
        kind: "original" as const,
        branch,
        targetBranch: null,
        workspaceId: null,
        runtimeAppId: chat.appId,
        writableTurnRunning,
        packageManager: null,
        hasUnmergedWork: false,
        integration: null,
      };
    },
  );

  createTypedHandler(
    workspaceContracts.getAppWorkspaceOverview,
    async (_, { appId }) => ({
      appId,
      isolationEnabled: isWorktreeIsolationEnabled(),
      writableChatIds: chatWorkspaceRegistry.getWritableChatIds(appId),
      workspaces: listWorkspacesForApp(appId)
        .filter((workspace) => workspace.status === "active")
        .map((workspace) => ({
          chatId: workspace.chatId,
          workspaceId: workspace.id,
          branch: workspace.branch,
          phase: workspace.integrationStatus,
        })),
    }),
  );

  createTypedHandler(workspaceContracts.retryIntegration, async (_, input) => {
    await chatWorkspaceService.retryIntegration(input.chatId);
  });

  createTypedHandler(
    workspaceContracts.deleteChatWorkspace,
    async (_, input) => {
      await chatWorkspaceService.deleteChatWorkspace(input.chatId);
    },
  );

  createTypedHandler(workspaceContracts.undoTurns, async (_, input) =>
    undoIsolatedChatTurns(input),
  );
}
