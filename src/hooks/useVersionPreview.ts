import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAtomValue, useStore } from "jotai";
import { toast } from "sonner";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  CLOSED_STATE,
  type PreviewEvent,
  type PreviewState,
} from "@/version_preview/state";
import { createVersionPreviewRuntime } from "@/version_preview/commands";
import {
  ensureVersionPreviewController,
  getVersionPreviewController,
  getVersionPreviewRecoveryEntries,
  initVersionPreviewRuntime,
  isVersionPreviewRuntimeInitialized,
  notifyVersionPreviewAppChanged,
  subscribeVersionPreviewRegistry,
  type VersionPreviewRecoveryEntry,
} from "@/version_preview/registry";

/**
 * Binds a component to the version preview controller for the given app.
 *
 * Render stays pure: reading the snapshot never creates a controller or
 * touches module state — creation happens inside send(), which only runs
 * from event handlers. Controllers live in a module-scope registry so
 * active checkouts, returns, and recovery survive unmounts.
 */
export function useVersionPreview(appId: number | null): {
  state: PreviewState;
  send: (event: PreviewEvent) => void;
} {
  const queryClient = useQueryClient();
  const store = useStore();

  const state = useSyncExternalStore(
    subscribeVersionPreviewRegistry,
    useCallback(
      () =>
        appId !== null
          ? (getVersionPreviewController(appId)?.getSnapshot() ?? CLOSED_STATE)
          : CLOSED_STATE,
      [appId],
    ),
  );

  const send = useCallback(
    (event: PreviewEvent) => {
      if (appId === null) {
        return;
      }
      // Lazy fallback: the global bridge initializes the runtime in a
      // layout effect, but sends are event-handler work so initializing
      // here is safe and keeps the hook usable without the bridge.
      if (!isVersionPreviewRuntimeInitialized()) {
        initVersionPreviewRuntime(
          createVersionPreviewRuntime({ queryClient, store }),
        );
      }
      ensureVersionPreviewController(appId).send(event);
    },
    [appId, queryClient, store],
  );

  return { state, send };
}

/** All sessions currently in recovery-required, across apps. */
export function useVersionPreviewRecovery(): VersionPreviewRecoveryEntry[] {
  return useSyncExternalStore(
    subscribeVersionPreviewRegistry,
    getVersionPreviewRecoveryEntries,
  );
}

const recoveryToastId = (appId: number) => `version-preview-recovery-${appId}`;

/**
 * Global bridge, mounted once in the app layout:
 * - installs the production command runtime after commit (first init wins);
 * - converts selected-app changes into APP_CHANGED for the app the user
 *   left, so its session drains (returns its repository) in the background;
 * - surfaces recovery-required sessions as persistent toasts with a real
 *   RETRY_RETURN action, regardless of which app or pane is on screen. The
 *   recovery snapshot's reference only changes when the recovery set (or a
 *   deliberate re-surface) changes, so toasts are not re-issued on
 *   unrelated controller activity.
 */
export function useVersionPreviewGlobalBridge(): void {
  const queryClient = useQueryClient();
  const store = useStore();
  useEffect(() => {
    initVersionPreviewRuntime(
      createVersionPreviewRuntime({ queryClient, store }),
    );
  }, [queryClient, store]);

  const selectedAppId = useAtomValue(selectedAppIdAtom);
  const previousAppIdRef = useRef<number | null>(selectedAppId);

  useEffect(() => {
    const previousAppId = previousAppIdRef.current;
    previousAppIdRef.current = selectedAppId;
    if (previousAppId !== null && previousAppId !== selectedAppId) {
      notifyVersionPreviewAppChanged(previousAppId, selectedAppId);
    }
  }, [selectedAppId]);

  const recoveryEntries = useVersionPreviewRecovery();
  const shownToastAppIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const activeAppIds = new Set(recoveryEntries.map((entry) => entry.appId));
    for (const appId of shownToastAppIdsRef.current) {
      if (!activeAppIds.has(appId)) {
        toast.dismiss(recoveryToastId(appId));
      }
    }
    for (const entry of recoveryEntries) {
      toast.error(
        "Unable to return to the branch that was active before previewing this version.",
        {
          id: recoveryToastId(entry.appId),
          duration: Infinity,
          action: {
            label: "Retry",
            onClick: () => entry.retry(),
          },
        },
      );
    }
    shownToastAppIdsRef.current = activeAppIds;
  }, [recoveryEntries]);
}
