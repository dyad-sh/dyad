import { db } from "@/db";
import { chats } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readSettings } from "@/main/settings";
import type { UserSettings } from "@/lib/schemas";
import { resolveChatModeForTurn } from "../handlers/chat_mode_resolution";

/** Children inherit the accepted turn snapshot; standalone calls resolve the chat. */
export async function getChatInferenceSettings(
  chatId: number,
  acceptedSettings?: UserSettings,
): Promise<UserSettings> {
  if (acceptedSettings) return acceptedSettings;
  const settings = readSettings();
  const chat = await db.query.chats.findFirst({
    where: eq(chats.id, chatId),
    columns: { chatMode: true, modelSelection: true },
  });
  const { mode } = await resolveChatModeForTurn({
    storedChatMode: chat?.chatMode,
    settings: {
      ...settings,
      selectedModel: chat?.modelSelection ?? settings.selectedModel,
    },
  });
  return {
    ...settings,
    selectedChatMode: mode,
    ...(settings.proModelUsage === "api-key" && chat?.modelSelection
      ? { selectedModel: chat.modelSelection }
      : {}),
  };
}
