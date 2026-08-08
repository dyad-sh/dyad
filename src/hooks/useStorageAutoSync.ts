import { useEffect, useMemo, useRef } from "react";
import { useAtomValue } from "jotai";

import {
  chatAgentHistoryAtom,
  hermesAgentHistoryAtom,
} from "@/atoms/chatAgentAtoms";
import { ipc } from "@/ipc/types";
import type { UserSettings } from "@/lib/schemas";

const AUTO_SYNC_DELAY_MS = 1_500;
const AUTO_SYNC_INTERVAL_MS = 30_000;

export function useStorageAutoSync(storage: UserSettings["storage"]) {
  const chatHistory = useAtomValue(chatAgentHistoryAtom);
  const hermesHistory = useAtomValue(hermesAgentHistoryAtom);
  const syncInFlightRef = useRef(false);

  const conversations = useMemo(
    () => [
      ...chatHistory.map((conversation) => ({
        id: conversation.id,
        title: conversation.title,
        source: "Chat Agent",
        updatedAt: conversation.updatedAt,
        messages: conversation.messages.map(({ role, content }) => ({
          role,
          content,
        })),
      })),
      ...Object.entries(hermesHistory).flatMap(([agentId, history]) =>
        history.map((conversation) => ({
          id: conversation.id,
          title: conversation.title,
          source: `Hermes ${agentId}`,
          updatedAt: conversation.updatedAt,
          messages: conversation.messages.map(({ role, content }) => ({
            role,
            content,
          })),
        })),
      ),
    ],
    [chatHistory, hermesHistory],
  );

  useEffect(() => {
    const preferences = {
      destination: storage?.destination ?? ("local" as const),
      localVaultPath: storage?.localVaultPath,
      autoSync: storage?.autoSync ?? true,
      syncConversations: storage?.syncConversations ?? true,
      syncGeneratedMedia: storage?.syncGeneratedMedia ?? true,
      syncSystemNotes: storage?.syncSystemNotes ?? true,
    };
    const destinationReady =
      preferences.destination === "local"
        ? Boolean(preferences.localVaultPath?.trim())
        : true;
    if (!preferences.autoSync || !destinationReady) return;

    const runSync = () => {
      if (syncInFlightRef.current) return;
      syncInFlightRef.current = true;
      void ipc.storage
        .sync({
          preferences,
          chatAgentConversations: conversations,
        })
        .catch((error) => {
          console.warn("Automatic storage sync failed", error);
        })
        .finally(() => {
          syncInFlightRef.current = false;
        });
    };
    const timeout = window.setTimeout(runSync, AUTO_SYNC_DELAY_MS);
    const interval = window.setInterval(runSync, AUTO_SYNC_INTERVAL_MS);

    return () => {
      window.clearTimeout(timeout);
      window.clearInterval(interval);
    };
  }, [conversations, storage]);
}
