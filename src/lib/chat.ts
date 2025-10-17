import { IpcClient } from "../ipc/ipc_client";
import type { ChatSummary } from "./schemas";
import type { CreateAppParams, CreateAppResult } from "../ipc/ipc_types";

/**
 * Creates a new app with an initial chat and prompt.
 * @param {CreateAppParams} params - An object containing the name, path, and initial prompt.
 * @returns {Promise<CreateAppResult>} The created app and chat ID.
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

/**
 * Gets all chats from the database.
 * @param {number} [appId] - An optional app ID to filter chats by app.
 * @returns {Promise<ChatSummary[]>} An array of chat summaries with id, title, and createdAt.
 */
export async function getAllChats(appId?: number): Promise<ChatSummary[]> {
  try {
    return await IpcClient.getInstance().getChats(appId);
  } catch (error) {
    console.error("[CHAT] Error getting all chats:", error);
    throw error;
  }
}
