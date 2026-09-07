import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import { readSettings } from "@/main/settings";
import { executionBackendForModel } from "@/shared/execution_backend";
import { resolveDefaultModelSelection } from "./model_effort";
import type { ModelSelection } from "@/lib/schemas";
import type { ChatMode } from "../../lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "../../paths/paths";
import { getCurrentCommitHash } from "./git_utils";
import { getInitialChatModeForNewChat } from "../handlers/chat_mode_resolution";
import { assertAppChatCreationOpen } from "../services/app_chat_creation_fence";
import {
  appOperationCoordinator,
  readAppResource,
} from "../services/app_operation_coordinator";

const logger = log.scope("chat_creation_utils");

export async function createChatForApp({
  appId,
  title,
  initialChatMode,
  modelSelection,
}: {
  appId: number;
  title?: string;
  initialChatMode?: ChatMode;
  modelSelection?: ModelSelection;
}): Promise<number> {
  assertAppChatCreationOpen(appId);
  return appOperationCoordinator.run(
    {
      appId,
      operation: "create-chat",
      resources: [
        readAppResource("app-path"),
        "chat-membership",
        readAppResource("repository-ref"),
      ],
    },
    async () => {
      // App deletion installs its fences before draining admitted operations.
      // A creator either commits before deletion snapshots children or is
      // rejected before it can add a late child.
      assertAppChatCreationOpen(appId);
      const app = await db.query.apps.findFirst({
        where: eq(apps.id, appId),
        columns: { path: true },
      });
      if (!app) {
        throw new DyadError("App not found", DyadErrorKind.NotFound);
      }

      let initialCommitHash = null;
      try {
        initialCommitHash = await getCurrentCommitHash({
          path: getDyadAppPath(app.path),
        });
      } catch (error) {
        logger.error("Error getting git revision:", error);
      }

      const chatMode = await getInitialChatModeForNewChat(initialChatMode);
      const selected =
        modelSelection ??
        (readSettings().selectedModel.provider === "claude-code"
          ? await resolveDefaultModelSelection(readSettings())
          : undefined);
      const [chat] = await db
        .insert(chats)
        .values({
          appId,
          title,
          initialCommitHash,
          chatMode,
          modelSelection: selected,
          executionBackend: executionBackendForModel(selected),
        })
        .returning();
      logger.info(
        "Created chat:",
        chat.id,
        "for app:",
        appId,
        "with initial commit hash:",
        initialCommitHash,
      );
      return chat.id;
    },
  );
}
