import { useState, useEffect, useCallback } from "react";
import { useAtom, useAtomValue } from "jotai";
import { versionsListAtom } from "@/atoms/appAtoms";
import { IpcClient } from "@/ipc/ipc_client";
import { showError } from "@/lib/toast";
import { chatMessagesAtom, selectedChatIdAtom } from "@/atoms/chatAtoms";

export function useVersions(appId: number | null) {
  const [versions, setVersions] = useAtom(versionsListAtom);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const selectedChatId = useAtomValue(selectedChatIdAtom);
  const [, setMessages] = useAtom(chatMessagesAtom);
  useEffect(() => {
    const loadVersions = async () => {
      // If no app is selected, clear versions and return
      if (appId === null) {
        setVersions([]);
        setLoading(false);
        return;
      }

      try {
        const ipcClient = IpcClient.getInstance();
        const versionsList = await ipcClient.listVersions({ appId });

        setVersions(versionsList);
        setError(null);
      } catch (error) {
        console.error("Error loading versions:", error);
        setError(error instanceof Error ? error : new Error(String(error)));
      } finally {
        setLoading(false);
      }
    };

    loadVersions();
  }, [appId, setVersions]);

  const refreshVersions = useCallback(async () => {
    if (appId === null) {
      return;
    }

    try {
      const ipcClient = IpcClient.getInstance();
      const versionsList = await ipcClient.listVersions({ appId });
      setVersions(versionsList);
      setError(null);
    } catch (error) {
      console.error("Error refreshing versions:", error);
      setError(error instanceof Error ? error : new Error(String(error)));
    }
  }, [appId, setVersions, setError]);

  const revertVersion = useCallback(
    async ({ versionId }: { versionId: string }) => {
      if (appId === null) {
        return;
      }

      try {
        const ipcClient = IpcClient.getInstance();
        await ipcClient.revertVersion({ appId, previousVersionId: versionId });
        await refreshVersions();
        if (selectedChatId) {
          const chat = await IpcClient.getInstance().getChat(selectedChatId);
          setMessages(chat.messages);
        }
      } catch (error) {
        showError(error);
      }
    },
    [appId, setVersions, setError, selectedChatId, setMessages],
  );

  return { versions, loading, error, refreshVersions, revertVersion };
}
