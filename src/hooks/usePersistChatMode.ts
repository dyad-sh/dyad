import { useCallback, useRef, useMemo } from "react";
import { useSettings } from "./useSettings";
import { persistChatModeToDb } from "@/lib/chatModeUtils";
import type { ChatMode } from "@/lib/schemas";
import { useInitialChatMode } from "./useInitialChatMode";
import { useCurrentChatIdFromRoute } from "./useCurrentChatIdFromRoute";

type PersistChatModeOptions = {
  chatId: number;
  appId: number;
  chatMode: ChatMode;
  optimistic?: boolean;
  onPersistSuccess?: () => void | Promise<void>;
  onPersistError?: (error: unknown) => void | Promise<void>;
};

type PersistChatModeResult = {
  success: boolean;
  sameRoute: boolean;
};

export function usePersistChatMode() {
  const { updateSettings, settings } = useSettings();
  const initialChatMode = useInitialChatMode();
  const getCurrentChatId = useCurrentChatIdFromRoute();

  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const updateSettingsRef = useRef(updateSettings);
  updateSettingsRef.current = updateSettings;

  const initialChatModeRef = useRef(initialChatMode);
  initialChatModeRef.current = initialChatMode;

  const getCurrentChatIdRef = useRef(getCurrentChatId);
  getCurrentChatIdRef.current = getCurrentChatId;

  const activePersistsRef = useRef<Map<number, Promise<PersistChatModeResult>>>(
    new Map(),
  );

  const persistChatMode = useCallback(
    async (options: PersistChatModeOptions): Promise<PersistChatModeResult> => {
      const {
        chatId,
        appId,
        chatMode,
        optimistic = false,
        onPersistSuccess,
        onPersistError,
      } = options;

      const persistInternal = async (): Promise<PersistChatModeResult> => {
        const currentUpdateSettings = updateSettingsRef.current;

        const previousMode =
          settingsRef.current?.selectedChatMode ??
          initialChatModeRef.current ??
          "build";

        try {
          //optimistic for immediate ui update if enabled(without waiting persitence to complete)
          if (optimistic) {
            await currentUpdateSettings({ selectedChatMode: chatMode });
          }
          await persistChatModeToDb(chatId, appId, chatMode);

          // Call onPersistSuccess in separate try/catch so  errors don't trigger rollback
          try {
            await onPersistSuccess?.();
          } catch (callbackError) {
            console.error("onPersistSuccess callback failed:", callbackError);
          }

          // make sure user still in same chat before updating settings
          const currentIdFromRoute = getCurrentChatIdRef.current();
          if (!optimistic && currentIdFromRoute === chatId) {
            await currentUpdateSettings({ selectedChatMode: chatMode });
          }
          return { success: true, sameRoute: currentIdFromRoute === chatId };
        } catch (error) {
          console.error("Failed to persist chat mode:", error);

          if (optimistic) {
            // Only rollback if user is still on the same chat
            const currentIdFromRoute = getCurrentChatIdRef.current();
            if (currentIdFromRoute === chatId) {
              try {
                await currentUpdateSettings({ selectedChatMode: previousMode });
              } catch (rollbackError) {
                console.error("Failed to rollback chat mode:", rollbackError);
              }
            }
          }

          try {
            await onPersistError?.(error);
          } catch (callbackError) {
            console.error("onPersistError callback failed:", callbackError);
          }
          const currentIdFromRoute = getCurrentChatIdRef.current();
          return { success: false, sameRoute: currentIdFromRoute === chatId };
        }
      };

      const existingPromise = activePersistsRef.current.get(chatId);
      const newPromise = (existingPromise ?? Promise.resolve())
        .catch(() => {})
        .then(() => persistInternal())
        .finally(() => {
          if (activePersistsRef.current.get(chatId) === newPromise) {
            activePersistsRef.current.delete(chatId);
          }
        });

      activePersistsRef.current.set(chatId, newPromise);
      return newPromise;
    },
    [],
  );

  return useMemo(() => ({ persistChatMode }), [persistChatMode]);
}
