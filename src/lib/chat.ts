import { IpcClient } from "../ipc/ipc_client";
import type { CreateAppParams, CreateAppResult } from "../ipc/ipc_types";

/**
 * Create a new app with an initial chat and prompt
 * @param params Object containing name, path, and initialPrompt
 * @returns The created app and chatId
 */
export async function createApp(
  params: CreateAppParams,
): Promise<CreateAppResult> {
  try {
    return await IpcClient.getInstance().createApp(params);
  } catch (error) {
    console.error("[CHAT] Error creating app:", error);
    throw error;
  }
}
