import { useCallback, useEffect, useRef } from "react";
import { ipc, type AppOutput } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendConsoleEntriesForAppAtom,
  setPackageManagerWarningForAppAtom,
  setPreviewAppExitForAppAtom,
  setPreviewErrorForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { showError, showInputRequest } from "@/lib/toast";
import {
  shouldShowPnpmMinimumReleaseAgeWarning,
  type RuntimeMode2,
} from "@/lib/schemas";
import { useAppRunManager } from "@/app_run/AppRunProvider";
import { useAppRunState } from "./useAppRun";
import { useSettings } from "./useSettings";

const CLOUD_SYNC_ERROR_TOAST_WINDOW_MS = 30_000;

export function useRebuildAppAfterPnpmInstall() {
  const manager = useAppRunManager();

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
  const manager = useAppRunManager();
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const setPreviewError = useSetAtom(setPreviewErrorForAppAtom);
  const setPreviewAppExit = useSetAtom(setPreviewAppExitForAppAtom);
  const setPackageManagerWarning = useSetAtom(
    setPackageManagerWarningForAppAtom,
  );
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

  // Thin producer: parses the proxy-server stdout line into a typed
  // PROXY_READY event for the app's run-state machine. The machine decides
  // whether it applies now, is buffered for an in-flight operation, or is a
  // stale line that must be ignored.
  const processProxyServerOutput = useCallback(
    (output: AppOutput) => {
      const matchesProxyServerStart = output.message.includes(
        "[dyad-proxy-server]started=[",
      );
      if (matchesProxyServerStart) {
        const proxyUrlMatch = output.message.match(
          /\[dyad-proxy-server\]started=\[(.*?)\]/,
        );
        const originalUrlMatch = output.message.match(/original=\[(.*?)\]/);
        const modeMatch = output.message.match(/mode=\[(.*?)\]/);

        if (proxyUrlMatch && proxyUrlMatch[1]) {
          const proxyUrl = proxyUrlMatch[1];
          const originalUrl = originalUrlMatch && originalUrlMatch[1];
          const mode = (modeMatch?.[1] as RuntimeMode2 | undefined) ?? "host";
          manager.send(output.appId, {
            type: "PROXY_READY",
            url: {
              appUrl: proxyUrl,
              originalUrl: originalUrl!,
              mode,
            },
          });
        }
      }
    },
    [manager],
  );

  const processAppOutput = useCallback(
    (output: AppOutput) => {
      if (
        output.type === "agent-lifecycle-started" &&
        output.lifecycleRequestId &&
        output.lifecycleOperation
      ) {
        manager.beginExternal(output.appId, {
          requestId: output.lifecycleRequestId,
          operation: output.lifecycleOperation,
          startedAt: output.timestamp ?? Date.now(),
        });
        return null;
      }

      if (
        (output.type === "agent-lifecycle-succeeded" ||
          output.type === "agent-lifecycle-failed") &&
        output.lifecycleRequestId
      ) {
        manager.settleExternal(
          output.appId,
          output.lifecycleRequestId,
          output.type === "agent-lifecycle-failed"
            ? { message: output.message }
            : undefined,
        );
        return null;
      }

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

        setPreviewError({
          appId: output.appId,
          error: (current) => {
            if (current && current.source !== "dyad-sync") {
              return current;
            }
            return {
              message: output.message,
              source: "dyad-sync",
            };
          },
        });
      }

      if (output.type === "sync-recovered") {
        syncErrorToastRef.current.delete(output.appId);
        setPreviewError({
          appId: output.appId,
          error: (current) =>
            current?.source === "dyad-sync" ? undefined : current,
        });
      }

      if (output.type === "app-exit") {
        setPreviewAppExit({
          appId: output.appId,
          exit: {
            appId: output.appId,
            exitCode: output.exitCode ?? null,
            timestamp: output.timestamp ?? Date.now(),
          },
        });
        manager.send(output.appId, {
          type: "APP_EXIT",
          exitCode: output.exitCode ?? null,
          timestamp: output.timestamp ?? Date.now(),
        });
        return null;
      }

      if (
        output.type === "package-manager-warning" &&
        (output.warningKind === "pnpm-migration" ||
          (pnpmWarningSettingRef.current.hasSettings &&
            pnpmWarningSettingRef.current.showWarning))
      ) {
        setPackageManagerWarning({
          appId: output.appId,
          warning: {
            kind: output.warningKind ?? "release-age",
            message: output.message,
          },
        });
      }

      if (
        output.message.includes("hmr update") &&
        output.message.includes("[vite]")
      ) {
        manager.send(output.appId, {
          type: "HMR_DETECTED",
        });
      }

      processProxyServerOutput(output);

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
    [
      processProxyServerOutput,
      setPackageManagerWarning,
      setPreviewAppExit,
      setPreviewError,
      manager,
    ],
  );

  useEffect(() => {
    const unsubscribe = ipc.events.misc.onAppOutput((output) => {
      const entry = processAppOutput(output);
      if (entry) {
        appendConsoleEntries({
          appId: output.appId,
          entries: [entry],
        });
      }
    });

    return unsubscribe;
  }, [appendConsoleEntries, processAppOutput]);

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
        appendConsoleEntries({ appId, entries });
      }
    });

    return unsubscribe;
  }, [appendConsoleEntries, processAppOutput]);
}

export function useRunApp() {
  const manager = useAppRunManager();
  const appId = useAtomValue(selectedAppIdAtom);
  const runState = useAppRunState(appId);
  const loading = runState.type === "starting" || runState.type === "stopping";

  const runApp = useCallback(
    (appId: number) =>
      manager.dispatch(appId, {
        type: "START",
        startedAt: Date.now(),
      }),
    [manager],
  );

  const stopApp = useCallback(
    async (appId: number | null) => {
      if (appId === null) {
        return;
      }
      await manager.dispatch(appId, {
        type: "STOP",
        startedAt: Date.now(),
      });
    },
    [manager],
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
      await manager.dispatch(targetAppId, {
        type: "RESTART",
        startedAt: Date.now(),
        options: { removeNodeModules, recreateSandbox },
      });
    },
    [appId, manager],
  );

  const refreshAppIframe = useCallback(async () => {
    if (appId === null) {
      return;
    }
    manager.send(appId, { type: "MANUAL_RELOAD" });
  }, [appId, manager]);

  return {
    loading,
    runApp,
    stopApp,
    restartApp,
    refreshAppIframe,
  };
}
