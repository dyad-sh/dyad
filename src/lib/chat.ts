import { ipc } from "../ipc/types";
import type { CreateAppParams, CreateAppResult } from "../ipc/types";

/**
 * Create a new app with an initial chat and prompt
 * @param params Object containing name, path, and initialPrompt
 * @returns The created app and chatId
 */
export async function createApp(
  params: CreateAppParams,
): Promise<CreateAppResult> {
  try {
    return await ipc.app.createApp(params);
  } catch (error) {
    console.error("[CHAT] Error creating app:", error);
    throw error;
  }
}
