import { useCallback } from "react";
import { useAtomValue, useSetAtom, useStore } from "jotai";
import { integrationProviderSelectionAtom } from "@/atoms/integrationAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { useLoadApp } from "@/hooks/useLoadApp";
import { getCompletedIntegrationProvider } from "@/components/chat/dyadAddIntegrationUtils";
import { getUserInputReadModel } from "@/user_input/read_model";
import {
  usePendingIntegrations,
  useRespondingRequestIds,
} from "@/user_input/hooks";
import { usePostHog } from "posthog-js/react";

/**
 * Shared continue logic for the integration setup flow. Request lifecycle
 * reads and responses go through the generic user-input read-model adapter.
 */
export function useIntegrationContinue() {
  const posthog = usePostHog();
  const chatId = useAtomValue(selectedChatIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const store = useStore();
  const userInputReadModel = getUserInputReadModel({ store });
  const pendingIntegrationMap = usePendingIntegrations();
  const respondingRequestIds = useRespondingRequestIds();
  const setIntegrationProviderSelection = useSetAtom(
    integrationProviderSelectionAtom,
  );
  const setPreviewMode = useSetAtom(previewModeAtom);
  const { app, loading: isAppLoading } = useLoadApp(selectedAppId);

  const pendingIntegration =
    chatId != null ? pendingIntegrationMap.get(chatId) : undefined;
  const provider = pendingIntegration?.provider;
  const completedProvider = getCompletedIntegrationProvider(app);
  const canContinue =
    !!pendingIntegration && !!provider && completedProvider === provider;
  const canSkip =
    !!pendingIntegration && !isAppLoading && completedProvider === null;
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
    const responded = await userInputReadModel.respond(
      pendingIntegration.requestId,
      {
        kind: "integration",
        provider,
        completed: true,
      },
    );
    if (!responded) return;
    posthog.capture("integration-setup:complete", { provider });
    setIntegrationProviderSelection((prev) => {
      if (!prev.has(pendingIntegration.requestId)) return prev;
      const next = new Map(prev);
      next.delete(pendingIntegration.requestId);
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
    userInputReadModel,
    posthog,
    setIntegrationProviderSelection,
    setPreviewMode,
  ]);

  const handleSkip = useCallback(async (): Promise<boolean> => {
    if (!pendingIntegration || !canSkip || isSubmitting) {
      return false;
    }
    const responded = await userInputReadModel.respond(
      pendingIntegration.requestId,
      {
        kind: "integration",
        provider: null,
        completed: false,
      },
    );
    if (!responded) return false;
    setIntegrationProviderSelection((prev) => {
      if (!prev.has(pendingIntegration.requestId)) return prev;
      const next = new Map(prev);
      next.delete(pendingIntegration.requestId);
      return next;
    });
    setPreviewMode("preview");
    return true;
  }, [
    pendingIntegration,
    canSkip,
    isSubmitting,
    userInputReadModel,
    setIntegrationProviderSelection,
    setPreviewMode,
  ]);

  return {
    pendingIntegration,
    provider,
    completedProvider,
    canContinue,
    canSkip,
    isSubmitting,
    handleContinue,
    handleSkip,
  };
}
