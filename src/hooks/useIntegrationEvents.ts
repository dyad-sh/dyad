import { useEffect, useRef } from "react";
import { useSetAtom } from "jotai";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue } from "jotai";
import { useSettings } from "./useSettings";
import { pendingIntegrationAtom } from "@/atoms/integrationAtoms";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  integrationEventClient,
  type IntegrationPromptPayload,
} from "@/ipc/types/integration";
import { showUserInputNotification } from "@/lib/userInputNotification";

/**
 * Listens for `integration:prompt` events emitted by the add_integration agent
 * tool and stores the pending request keyed by chatId. Should be called once
 * at the app root.
 */
export function useIntegrationEvents() {
  const setPendingIntegration = useSetAtom(pendingIntegrationAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const queryClient = useQueryClient();
  const { settings } = useSettings();

  const selectedAppIdRef = useRef(selectedAppId);
  const settingsRef = useRef(settings);
  selectedAppIdRef.current = selectedAppId;
  settingsRef.current = settings;

  useEffect(() => {
    const unsubscribe = integrationEventClient.onPrompt(
      (payload: IntegrationPromptPayload) => {
        setPendingIntegration((prev) => {
          const next = new Map(prev);
          next.set(payload.chatId, payload);
          return next;
        });

        showUserInputNotification({
          appId: selectedAppIdRef.current,
          queryClient,
          settings: settingsRef.current,
          body: "Database integration setup needs your input",
          requireInteraction: true,
        });
      },
    );
    return () => unsubscribe();
  }, [setPendingIntegration, queryClient]);
}
