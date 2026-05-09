import { QueryClient } from "@tanstack/react-query";
import { ChatSummary } from "./schemas";
import { queryKeys } from "./queryKeys";
import { ipc } from "../ipc/types";

type ResolveChatSummaryOptions = {
  cacheOnly?: boolean;
};

/**
 * Resolves a minimal chat summary for a given chatId.
 * Cache-first with an optional IPC fallback.
 */
export async function resolveChatSummary(
  chatId: number,
  queryClient: QueryClient,
  options: ResolveChatSummaryOptions = {},
): Promise<ChatSummary | null> {
  const chatsCaches = queryClient.getQueriesData<ChatSummary[]>({
    queryKey: queryKeys.chats.all,
  });

  for (const [, cachedChats] of chatsCaches) {
    if (!Array.isArray(cachedChats)) continue;
    const found = cachedChats.find((c) => c.id === chatId);
    if (found) return found;
  }

  if (options.cacheOnly) return null;

  try {
    const chat = await ipc.chat.getChatMetadata(chatId);
    return {
      id: chat.id,
      appId: chat.appId,
      title: chat.title,
      createdAt: chat.createdAt,
      chatMode: chat.chatMode,
    };
  } catch (error) {
    console.warn(
      `[CHAT_UTILS] Failed to fetch chat metadata for ${chatId}:`,
      error,
    );
    return null;
  }
}

/**
 * Attempts to resolve an app name for a given appId.
 * Searches the local cache first, then falls back to IPC.
 */
export async function resolveAppNameForAppId(
  appId: number,
  queryClient: QueryClient,
): Promise<string> {
  const app = queryClient.getQueryData<{ name: string } | null>(
    queryKeys.apps.detail({ appId }),
  );
  if (app?.name) return app.name;

  try {
    const fetchedApp = await ipc.app.getApp(appId);
    return fetchedApp?.name ?? "Dyad";
  } catch (error) {
    console.error("[CHAT_UTILS] Failed to resolve app name via IPC:", error);
  }

  return "Dyad";
}

/**
 * Resolves the appId for a given chatId by checking the TanStack Query cache
 * and falling back to a direct IPC fetch if necessary.
 */
export async function resolveAppIdForChat(
  chatId: number,
  queryClient: QueryClient,
  options: ResolveChatSummaryOptions = {},
): Promise<number | null> {
  const summary = await resolveChatSummary(chatId, queryClient, options);
  return summary?.appId ?? null;
}
