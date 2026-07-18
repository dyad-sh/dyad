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
  getVersionPreviewRecoveryEntries,
  initVersionPreviewRuntime,
  isVersionPreviewRuntimeInitialized,
  notifyVersionPreviewAppChanged,
  subscribeVersionPreviewRegistry,
  type VersionPreviewRecoveryEntry,
} from "@/version_preview/registry";

const noopSubscribe = () => () => {};
const closedSnapshot = () => CLOSED_STATE;
const noopSend = () => {};

/**
 * Installs the production command runtime on first use. Idempotent: the
 * first initialization wins, matching the renderer's stable QueryClient and
 * default Jotai store. Tests install fakes via initVersionPreviewRuntime
 * before rendering.
 */
function useVersionPreviewRuntimeInit() {
  const queryClient = useQueryClient();
  const store = useStore();
  if (!isVersionPreviewRuntimeInitialized()) {
    initVersionPreviewRuntime(
      createVersionPreviewRuntime({ queryClient, store }),
    );
  }
}

/**
 * Binds a component to the version preview controller for the given app.
 * The controller lives in a module-scope registry so active checkouts,
 * returns, and recovery survive unmounts; this hook is only a window onto
 * it via useSyncExternalStore.
 */
export function useVersionPreview(appId: number | null): {
  state: PreviewState;
  send: (event: PreviewEvent) => void;
} {
  useVersionPreviewRuntimeInit();
  const controller =
    appId !== null ? ensureVersionPreviewController(appId) : null;
  const state = useSyncExternalStore(
    controller ? controller.subscribe : noopSubscribe,
    controller ? controller.getSnapshot : closedSnapshot,
  );
  const send = controller ? controller.send : noopSend;
  return { state, send };
}

/** All sessions currently in recovery-required, across apps. */
export function useVersionPreviewRecovery(): VersionPreviewRecoveryEntry[] {
  useVersionPreviewRuntimeInit();
  return useSyncExternalStore(
    subscribeVersionPreviewRegistry,
    getVersionPreviewRecoveryEntries,
  );
}

const recoveryToastId = (appId: number) => `version-preview-recovery-${appId}`;

/**
 * Global bridge, mounted once in the app layout:
 * - converts selected-app changes into APP_CHANGED for the app the user
 *   left, so its session drains (returns its repository) in the background;
 * - surfaces recovery-required sessions as persistent toasts with a real
 *   RETRY_RETURN action, regardless of which app or pane is on screen.
 */
export function useVersionPreviewGlobalBridge(): void {
  useVersionPreviewRuntimeInit();
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

  const showRecoveryToasts = useCallback(
    (entries: VersionPreviewRecoveryEntry[]) => {
      const activeAppIds = new Set(entries.map((entry) => entry.appId));
      for (const appId of shownToastAppIdsRef.current) {
        if (!activeAppIds.has(appId)) {
          toast.dismiss(recoveryToastId(appId));
        }
      }
      for (const entry of entries) {
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
    },
    [],
  );

  useEffect(() => {
    showRecoveryToasts(recoveryEntries);
  }, [recoveryEntries, showRecoveryToasts]);
}
