import { useSetAtom } from "jotai";
import { useCallback, useMemo, useRef } from "react";
import {
  selectedChatIdAtom,
  pushRecentViewedChatIdAtom,
  addSessionOpenedChatIdAtom,
  chatInputValueAtom,
} from "@/atoms/chatAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useNavigate } from "@tanstack/react-router";
import { useSettings } from "./useSettings";
import { useInitialChatMode } from "./useInitialChatMode";
import { ChatMode } from "@/lib/schemas";
import { useFreeAgentQuota } from "./useFreeAgentQuota";
import log from "electron-log";
import { resolveAllowedChatMode } from "@/lib/chatModeUtils";

const logger = log.scope("useSelectChat");

export function useSelectChat() {
  const setSelectedChatId = useSetAtom(selectedChatIdAtom);
  const setSelectedAppId = useSetAtom(selectedAppIdAtom);
  const pushRecentViewedChatId = useSetAtom(pushRecentViewedChatIdAtom);
  const addSessionOpenedChatId = useSetAtom(addSessionOpenedChatIdAtom);
  const setChatInputValue = useSetAtom(chatInputValueAtom);
  const navigate = useNavigate();
  const { updateSettings, settings, envVars } = useSettings();
  const initialChatMode = useInitialChatMode();
  const { isQuotaExceeded } = useFreeAgentQuota();

  // Refs to avoid callback recreation on settings/envVars mutations
  const settingsRef = useRef(settings);
  const envVarsRef = useRef(envVars);
  const isQuotaExceededRef = useRef(isQuotaExceeded);
  const updateSettingsRef = useRef(updateSettings);

  settingsRef.current = settings;
  envVarsRef.current = envVars;
  isQuotaExceededRef.current = isQuotaExceeded;
  updateSettingsRef.current = updateSettings;

  const selectChat = useCallback(
    ({
      chatId,
      appId,
      preserveTabOrder = false,
      prefillInput,
      chatMode,
    }: {
      chatId: number;
      appId: number;
      preserveTabOrder?: boolean;
      prefillInput?: string;
      chatMode?: ChatMode | null;
    }) => {
      setSelectedChatId(chatId);
      setSelectedAppId(appId);
      addSessionOpenedChatId(chatId);
      if (!preserveTabOrder) {
        pushRecentViewedChatId(chatId);
      }

      const navigationResult = navigate({
        to: "/chat",
        search: { id: chatId },
      });

      // Only update selectedChatMode when an explicit non-null chatMode is passed.
      // When chatMode is null/undefined (legacy chat), let useRestoreChatMode handle it.
      if (chatMode !== null && chatMode !== undefined && settingsRef.current) {
        const freeAgentQuotaAvailable = !isQuotaExceededRef.current;
        const resolvedMode = resolveAllowedChatMode({
          desiredMode: chatMode,
          fallbackMode: initialChatMode ?? "build",
          settings: settingsRef.current,
          envVars: envVarsRef.current,
          freeAgentQuotaAvailable,
        });

        updateSettingsRef
          .current({ selectedChatMode: resolvedMode.mode })
          .catch((error) => {
            logger.error("Error updating chat mode:", error);
          });
      }

      if (prefillInput !== undefined) {
        Promise.resolve(navigationResult)
          .then(() => {
            setChatInputValue(prefillInput);
          })
          .catch(() => {});
      }
    },
    [
      addSessionOpenedChatId,
      initialChatMode,
      navigate,
      pushRecentViewedChatId,
      setChatInputValue,
      setSelectedAppId,
      setSelectedChatId,
    ],
  );

  return useMemo(() => ({ selectChat }), [selectChat]);
}
