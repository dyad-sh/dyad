import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import {
  integrationProviderSelectionAtom,
  pendingIntegrationAtom,
} from "@/atoms/integrationAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { getCompletedIntegrationProvider } from "@/components/chat/dyadAddIntegrationUtils";
import {
  getUserInputProjectionAdapter,
  respondingRequestIdsAtom,
} from "@/user_input/projection";

/**
 * Shared continue logic for the integration setup flow. Request lifecycle
 * reads and responses go through the generic user-input projection adapter.
 */
export function useIntegrationContinue() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const store = useStore();
  const userInputProjection = getUserInputProjectionAdapter({ store });
  const pendingIntegrationMap = useAtomValue(pendingIntegrationAtom);
  const respondingRequestIds = useAtomValue(respondingRequestIdsAtom);
  const setIntegrationProviderSelection = useSetAtom(
    integrationProviderSelectionAtom,
  );
  const setPreviewMode = useSetAtom(previewModeAtom);
  const { app } = useLoadApp(selectedAppId);

  const pendingIntegration =
    chatId != null ? pendingIntegrationMap.get(chatId) : undefined;
  const provider = pendingIntegration?.provider;
  const completedProvider = getCompletedIntegrationProvider(app);
  const canContinue =
    !!pendingIntegration && !!provider && completedProvider === provider;
  const isSubmitting =
    pendingIntegration != null &&
    respondingRequestIds.has(pendingIntegration.requestId);

  const handleContinue = useCallback(async () => {
    if (
      chatId == null ||
      !pendingIntegration ||
      !provider ||
      !canContinue ||
      isSubmitting
    ) {
      return;
    }
    const responded = await userInputProjection.respond(
      pendingIntegration.requestId,
      {
        kind: "integration",
        provider,
        completed: true,
      },
    );
    if (!responded) return;
    setIntegrationProviderSelection((prev) => {
      if (!prev.has(chatId)) return prev;
      const next = new Map(prev);
      next.delete(chatId);
      return next;
    });
    // Switch the right sidebar back to the preview so the user sees the
    // resumed conversation rather than a now-empty configure panel.
    setPreviewMode("preview");
  }, [
    chatId,
    pendingIntegration,
    provider,
    canContinue,
    isSubmitting,
    userInputProjection,
    setIntegrationProviderSelection,
    setPreviewMode,
  ]);

  return {
    pendingIntegration,
    provider,
    completedProvider,
    canContinue,
    isSubmitting,
    handleContinue,
  };
}
