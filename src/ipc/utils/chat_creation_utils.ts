import { db } from "../../db";
import { apps, chats } from "../../db/schema";
import { eq } from "drizzle-orm";
import log from "electron-log";
import type { ChatMode } from "../../lib/schemas";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "../../paths/paths";
import { getCurrentCommitHash } from "./git_utils";
import { getInitialChatModeForNewChat } from "../handlers/chat_mode_resolution";

const logger = log.scope("chat_creation_utils");

export async function createChatForApp({
  appId,
  title,
  initialChatMode,
}: {
  appId: number;
  title?: string;
  initialChatMode?: ChatMode;
}): Promise<number> {
  // Get the app's path first
  const app = await db.query.apps.findFirst({
    where: eq(apps.id, appId),
    columns: {
      path: true,
    },
  });

  if (!app) {
    throw new DyadError("App not found", DyadErrorKind.NotFound);
  }

  let initialCommitHash = null;
  try {
    // Get the current git revision of the currently checked-out branch
    initialCommitHash = await getCurrentCommitHash({
      path: getDyadAppPath(app.path),
    });
  } catch (error) {
    logger.error("Error getting git revision:", error);
    // Continue without the git revision
  }

  const chatMode = await getInitialChatModeForNewChat(initialChatMode);

  const [chat] = await db
    .insert(chats)
    .values({
      appId,
      title,
      initialCommitHash,
      chatMode,
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
}
