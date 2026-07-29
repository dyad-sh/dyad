import { useCallback, useEffect, useRef } from "react";
import { ipc, type AppOutput } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { showError, showInputRequest } from "@/lib/toast";
import { shouldShowPnpmMinimumReleaseAgeWarning } from "@/lib/schemas";
import { useAppRunRemoteManager } from "@/app_run/AppRunRemoteProvider";
import { useAppRunState } from "./useAppRun";
import { useSettings } from "./useSettings";
import { usePreviewErrorFacade } from "@/app_wiring/preview_error_facade";
import { usePackageManagerWarningStore } from "@/package_manager_warnings/PackageManagerWarningProvider";
import { useMachineMutation } from "@/distributed_machines/use_machine_mutation";
import type {
  AppRunAdmission,
  AppRunOperationInput,
  AppRunRefusal,
} from "@/app_run/remote_manager";
import type { AppRunOperationOutcome } from "@/app_run/operations";

const CLOUD_SYNC_ERROR_TOAST_WINDOW_MS = 30_000;

export function runAppLifecycleInBackground(
  operation: "start" | "restart" | "rebuild",
  promise: Promise<void>,
): void {
  void promise.catch((error) => {
    console.error(`[app-run] Failed to ${operation} app:`, error);
  });
}

export function useRebuildAppAfterPnpmInstall() {
  const manager = useAppRunRemoteManager();

  return useCallback(
    (appId: number) =>
      manager.dispatch(appId, {
        type: "REBUILD",
        startedAt: Date.now(),
      }),
    [manager],
  );
}

/**
 * Hook to subscribe to app output events from the main process.
 * IMPORTANT: This hook should only be called ONCE in the app (in layout.tsx)
 * to avoid duplicate event subscriptions causing duplicate log entries.
 */
export function useAppOutputSubscription() {
  const { settings } = useSettings();
  const manager = useAppRunRemoteManager();
  const previewErrors = usePreviewErrorFacade();
  const packageWarnings = usePackageManagerWarningStore();
  const appId = useAtomValue(selectedAppIdAtom);
  const selectedAppIdRef = useRef(appId);
  const pnpmWarningSettingRef = useRef({
    hasSettings: Boolean(settings),
    showWarning: shouldShowPnpmMinimumReleaseAgeWarning(settings),
  });
  const syncErrorToastRef = useRef(
    new Map<number, { message: string; shownAt: number }>(),
  );

  useEffect(() => {
    selectedAppIdRef.current = appId;
  }, [appId]);

  useEffect(() => {
    pnpmWarningSettingRef.current = {
      hasSettings: Boolean(settings),
      showWarning: shouldShowPnpmMinimumReleaseAgeWarning(settings),
    };
  }, [
    settings,
    settings?.enablePnpmMinimumReleaseAgeWarning,
    settings?.hidePnpmMinimumReleaseAgeWarning,
  ]);

  // Runtime lifecycle producers route directly to the main actor. This
  // renderer listener owns only presentation effects and console buffering.
  const processAppOutput = useCallback(
    (output: AppOutput) => {
      if (output.type === "input-requested") {
        if (selectedAppIdRef.current !== output.appId) {
          return null;
        }
        showInputRequest(output.message, async (response) => {
          try {
            await ipc.app.respondToAppInput({
              appId: output.appId,
              response,
            });
          } catch (error) {
            console.error("Failed to respond to app input:", error);
          }
        });
        return null;
      }

      if (output.type === "sync-error") {
        const previousToast = syncErrorToastRef.current.get(output.appId);
        const now = Date.now();

        if (
          selectedAppIdRef.current === output.appId &&
          (!previousToast ||
            previousToast.message !== output.message ||
            now - previousToast.shownAt >= CLOUD_SYNC_ERROR_TOAST_WINDOW_MS)
        ) {
          showError(output.message);
          syncErrorToastRef.current.set(output.appId, {
            message: output.message,
            shownAt: now,
          });
        }

        previewErrors.setSyncError(output.appId, output.message);
      }

      if (output.type === "sync-recovered") {
        syncErrorToastRef.current.delete(output.appId);
        previewErrors.clearSyncError(output.appId);
      }

      if (output.type === "app-exit") {
        return null;
      }

      if (
        output.type === "package-manager-warning" &&
        (output.warningKind === "pnpm-migration" ||
          (pnpmWarningSettingRef.current.hasSettings &&
            pnpmWarningSettingRef.current.showWarning))
      ) {
        packageWarnings.setWarning(output.appId, {
          kind: output.warningKind ?? "release-age",
          message: output.message,
        });
      }

      if (
        output.type === "agent-lifecycle-started" ||
        output.message === "Restarting app..." ||
        output.message === "Rebuilding app after pnpm install..."
      ) {
        manager.previewConsole.clear(output.appId);
      }

      const logEntry = {
        level:
          output.type === "stderr" ||
          output.type === "client-error" ||
          output.type === "sync-error"
            ? ("error" as const)
            : ("info" as const),
        type: "server" as const,
        message: output.message,
        appId: output.appId,
        timestamp: output.timestamp ?? Date.now(),
      };

      if (output.type === "client-error") {
        ipc.misc.addLog(logEntry);
      }

      return logEntry;
    },
    [packageWarnings, previewErrors],
  );

  useEffect(() => {
    const unsubscribe = ipc.events.misc.onAppOutput((output) => {
      const entry = processAppOutput(output);
      if (entry) {
        manager.previewConsole.append(output.appId, [entry]);
      }
    });

    return unsubscribe;
  }, [manager, processAppOutput]);

  useEffect(() => {
    const unsubscribe = ipc.events.misc.onAppOutputBatch((outputs) => {
      const entriesByAppId = new Map<
        number,
        NonNullable<ReturnType<typeof processAppOutput>>[]
      >();
      for (const output of outputs) {
        const entry = processAppOutput(output);
        if (entry) {
          const entries = entriesByAppId.get(output.appId) ?? [];
          entries.push(entry);
          entriesByAppId.set(output.appId, entries);
        }
      }

      for (const [appId, entries] of entriesByAppId) {
        manager.previewConsole.append(appId, entries);
      }
    });

    return unsubscribe;
  }, [manager, processAppOutput]);
}

export function useRunApp() {
  const manager = useAppRunRemoteManager();
  const packageWarnings = usePackageManagerWarningStore();
  const appId = useAtomValue(selectedAppIdAtom);
  const runState = useAppRunState(appId);
  const view = appId === null ? undefined : manager.getView(appId);
  const mutation = useMachineMutation<
    { readonly appId: number; readonly operation: AppRunOperationInput },
    AppRunAdmission,
    AppRunOperationOutcome,
    AppRunRefusal
  >({
    connection: view?.connection ?? "disconnected",
    snapshot: view?.snapshot ?? { kind: "unavailable" },
    request: (input, observedRevision) => {
      const request = manager.prepareRequest(
        input.appId,
        input.operation,
        input.appId === appId ? observedRevision : undefined,
      );
      if (!request) {
        throw new Error("App run request does not target an active runtime");
      }
      return request;
    },
    classifyOutcome: (outcome) => {
      if (outcome.kind === "succeeded") return { kind: "succeeded" };
      if (outcome.kind === "failed") {
        return { kind: "failed", error: outcome.error };
      }
      return outcome.reason === "superseded"
        ? { kind: "superseded" }
        : { kind: "cancelled" };
    },
  });
  const mutateAppRun = mutation.mutate;
  const loading =
    runState.phase === "starting" || runState.phase === "stopping";

  const dispatchMutation = useCallback(
    async (targetAppId: number, operation: AppRunOperationInput) => {
      const settlement = await mutateAppRun({
        appId: targetAppId,
        operation,
      });
      await manager.applyPublicSettlement(targetAppId, operation, settlement);
    },
    [manager, mutateAppRun],
  );

  const runApp = useCallback(
    (appId: number) => {
      packageWarnings.clear(appId);
      return dispatchMutation(appId, {
        type: "START",
        startedAt: Date.now(),
      });
    },
    [dispatchMutation, packageWarnings],
  );

  const stopApp = useCallback(
    async (appId: number | null) => {
      if (appId === null) {
        return;
      }
      if (!manager.getSnapshot(appId).invocationRef) return;
      await dispatchMutation(appId, {
        type: "STOP",
        startedAt: Date.now(),
      });
    },
    [dispatchMutation, manager],
  );

  const restartApp = useCallback(
    async ({
      appId: requestedAppId,
      removeNodeModules = false,
      recreateSandbox = false,
    }: {
      appId?: number;
      removeNodeModules?: boolean;
      recreateSandbox?: boolean;
    } = {}) => {
      const targetAppId = requestedAppId ?? appId;
      if (targetAppId === null) {
        return;
      }
      packageWarnings.clear(targetAppId);
      await dispatchMutation(targetAppId, {
        type: "RESTART",
        startedAt: Date.now(),
        options: { removeNodeModules, recreateSandbox },
      });
    },
    [appId, dispatchMutation, packageWarnings],
  );

  const refreshAppIframe = useCallback(async () => {
    if (appId === null) {
      return;
    }
    manager.requestManualReload(appId);
  }, [appId, manager]);

  return {
    loading,
    runApp,
    stopApp,
    restartApp,
    refreshAppIframe,
  };
}
