import { useCallback } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import {
  pendingContinuationProviderAtom,
  pendingIntegrationAtom,
} from "@/atoms/integrationAtoms";
import { previewModeAtom, selectedAppIdAtom } from "@/atoms/appAtoms";
import { selectedChatIdAtom } from "@/atoms/chatAtoms";
import { integrationClient } from "@/ipc/types/integration";
import { useLoadApp } from "@/hooks/useLoadApp";
import { getCompletedIntegrationProvider } from "@/components/chat/dyadAddIntegrationUtils";
import { showError } from "@/lib/toast";

/**
 * Shared continue logic for the integration setup flow. Both the in-chat
 * DyadAddIntegration card and the Configure panel's IntegrationSection render
 * a Continue button, so the IPC + state-cleanup dance lives here once.
 *
 * `isSubmitting` is derived from `pendingContinuationProviderAtom` rather than
 * a local useState, so both Continue buttons stay in lockstep: clicking either
 * one disables both and shows "Continuing..." until the stream resumes.
 */
export function useIntegrationContinue() {
  const chatId = useAtomValue(selectedChatIdAtom);
  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const [pendingIntegrationMap, setPendingIntegrationMap] = useAtom(
    pendingIntegrationAtom,
  );
  const [pendingContinuationMap, setPendingContinuationMap] = useAtom(
    pendingContinuationProviderAtom,
  );
  const setPreviewMode = useSetAtom(previewModeAtom);
  const { app } = useLoadApp(selectedAppId);

  const pendingIntegration =
    chatId != null ? pendingIntegrationMap.get(chatId) : undefined;
  const provider = pendingIntegration?.provider;
  const completedProvider = getCompletedIntegrationProvider(app);
  const canContinue =
    !!pendingIntegration && !!provider && completedProvider === provider;
  const isSubmitting = chatId != null && pendingContinuationMap.has(chatId);

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
    // Queue the continuation BEFORE the IPC call. integrationClient.respond
    // unblocks the backend's integrationResolver.wait promise, which lets the
    // local-agent stream finish; useIntegrationContinuation only fires on the
    // streaming -> not-streaming transition, so if the stream ends before this
    // map is set the continuation message would be lost.
    setPendingContinuationMap((prev) => {
      const next = new Map(prev);
      next.set(chatId, provider);
      return next;
    });
    // Await the IPC: if it fails (e.g. webContents destroyed during nav, or a
    // serialization error) the backend's integrationResolver.wait promise would
    // otherwise hang to its 30-min timeout while the UI moves on as if
    // everything succeeded. On error, roll back the queued continuation,
    // surface a toast, and leave state intact.
    try {
      await integrationClient.respond({
        requestId: pendingIntegration.requestId,
        provider,
        completed: true,
      });
    } catch (error) {
      setPendingContinuationMap((prev) => {
        if (!prev.has(chatId)) return prev;
        const next = new Map(prev);
        next.delete(chatId);
        return next;
      });
      showError(
        `Failed to continue integration: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return;
    }
    setPendingIntegrationMap((prev) => {
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
    setPendingContinuationMap,
    setPendingIntegrationMap,
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
