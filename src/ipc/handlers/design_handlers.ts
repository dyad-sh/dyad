import { db } from "../../db";
import { chats } from "../../db/schema";
import { eq } from "drizzle-orm";

import log from "electron-log";
import { DyadError, DyadErrorKind } from "@/errors/dyad_error";
import { getDyadAppPath } from "../../paths/paths";
import { createTypedHandler } from "./base";
import { designContracts } from "../types/design";
import { loadDesignState } from "../utils/design_persistence";

const logger = log.scope("design_handlers");

export function registerDesignHandlers() {
  // Rehydrate a chat's persisted design (brief + interfaces) so mockups survive
  // reloads. Returns an empty state for chats that were never designed.
  createTypedHandler(designContracts.getDesignState, async (_, { chatId }) => {
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, chatId),
      with: { app: { columns: { path: true } } },
    });

    if (!chat) {
      throw new DyadError("Chat not found", DyadErrorKind.NotFound);
    }

    const appPath = getDyadAppPath(chat.app.path);
    const state = await loadDesignState(appPath, chatId);
    logger.debug(
      `Loaded design state for chat ${chatId}: brief=${!!state.brief}, interfaces=${state.interfaces.length}`,
    );
    return state;
  });
}
