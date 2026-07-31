import { useCallback, useEffect, useRef } from "react";
import { ipc, type AppOutput } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import { useAtomValue } from "jotai";
import { showInputRequest } from "@/lib/toast";
import { shouldShowPnpmMinimumReleaseAgeWarning } from "@/lib/schemas";
import { useAppRunRemoteManager } from "@/app_run/AppRunRemoteProvider";
import { useAppRunState } from "./useAppRun";
import { useSettings } from "./useSettings";
import { usePackageManagerWarningStore } from "@/package_manager_warnings/PackageManagerWarningProvider";
import { useMachineMutation } from "@/distributed_machines/use_machine_mutation";
import type {
  AppRunAdmission,
  AppRunRemoteManager,
  AppRunOperationInput,
  AppRunRefusal,
} from "@/app_run/remote_manager";
import type { AppRunOperationOutcome } from "@/app_run/operations";

function classifyAppRunOutcome(outcome: AppRunOperationOutcome) {
  if (outcome.kind === "succeeded") return { kind: "succeeded" } as const;
  if (outcome.kind === "failed") {
    return { kind: "failed", error: outcome.error } as const;
  }
  return outcome.reason === "superseded"
    ? ({ kind: "superseded" } as const)
    : ({ kind: "cancelled" } as const);
}

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
  const packageWarnings = usePackageManagerWarningStore();
  const appId = useAtomValue(selectedAppIdAtom);
  const selectedAppIdRef = useRef(appId);
  const pnpmWarningSettingRef = useRef({
    hasSettings: Boolean(settings),
    showWarning: shouldShowPnpmMinimumReleaseAgeWarning(settings),
  });

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
          output.type === "stderr" || output.type === "client-error"
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
    [packageWarnings],
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
  const prepareMutationRequest = useCallback(
    (
      input: {
        readonly appId: number;
        readonly operation: AppRunOperationInput;
      },
      observedRevision: Parameters<AppRunRemoteManager["prepareRequest"]>[2],
    ) =>
      manager.prepareRequest(
        input.appId,
        input.operation,
        input.appId === appId ? observedRevision : undefined,
      ),
    [appId, manager],
  );
  const mutation = useMachineMutation<
    { readonly appId: number; readonly operation: AppRunOperationInput },
    AppRunAdmission,
    AppRunOperationOutcome,
    AppRunRefusal
  >({
    connection: view?.connection ?? "disconnected",
    snapshot: view?.snapshot ?? { kind: "unavailable" },
    request: prepareMutationRequest,
    classifyOutcome: classifyAppRunOutcome,
    requestOwnership: "parallel",
  });
  const mutateAppRunRef = useRef(mutation.mutate);
  mutateAppRunRef.current = mutation.mutate;
  const loading =
    runState.phase === "starting" ||
    runState.phase === "stopping" ||
    mutation.admission.kind === "preparing" ||
    mutation.execution.kind === "running";

  const dispatchMutation = useCallback(
    async (targetAppId: number, operation: AppRunOperationInput) => {
      const settlement = await mutateAppRunRef.current({
        appId: targetAppId,
        operation,
      });
      await manager.applyPublicSettlement(targetAppId, operation, settlement);
    },
    [manager],
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
      await dispatchMutation(appId, {
        type: "STOP",
        startedAt: Date.now(),
      });
    },
    [dispatchMutation],
  );

  const restartApp = useCallback(
    async ({
      appId: requestedAppId,
      removeNodeModules = false,
    }: {
      appId?: number;
      removeNodeModules?: boolean;
    } = {}) => {
      const targetAppId = requestedAppId ?? appId;
      if (targetAppId === null) {
        return;
      }
      const warningBeforeRestart = packageWarnings.getSnapshot(targetAppId);
      await dispatchMutation(targetAppId, {
        type: "RESTART",
        startedAt: Date.now(),
        options: { removeNodeModules },
      });
      if (
        warningBeforeRestart !== undefined &&
        packageWarnings.getSnapshot(targetAppId) === warningBeforeRestart
      ) {
        packageWarnings.clear(targetAppId);
      }
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
