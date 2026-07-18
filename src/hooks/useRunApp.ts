import { useCallback, useEffect, useRef } from "react";
import { createStore, useStore } from "jotai";
import { ipc, type AppOutput } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendConsoleEntriesForAppAtom,
  bumpPreviewReloadTokenForAppAtom,
  clearPackageManagerWarningForAppAtom,
  currentPreviewLoadingAtom,
  previewCurrentUrlAtom,
  setAppUrlForAppAtom,
  setConsoleEntriesForAppAtom,
  setPackageManagerWarningForAppAtom,
  setPreviewAppExitForAppAtom,
  setPreviewErrorForAppAtom,
  setPreviewRunStateForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import { showError, showInputRequest } from "@/lib/toast";
import {
  shouldShowPnpmMinimumReleaseAgeWarning,
  type RuntimeMode2,
} from "@/lib/schemas";
import { useSettings } from "./useSettings";

const CLOUD_SYNC_ERROR_TOAST_WINDOW_MS = 30_000;

type JotaiStore = ReturnType<typeof createStore>;

/**
 * Restarts an app by explicit id, writing preview runtime state through the
 * given Jotai store. Shared by useRunApp (bound to the selected app) and the
 * version preview command adapter (bound to a session's captured app).
 * Errors are reported into preview state; this function never throws.
 */
export async function restartAppWithStore(
  store: JotaiStore,
  appId: number,
  {
    removeNodeModules = false,
    recreateSandbox = false,
  }: { removeNodeModules?: boolean; recreateSandbox?: boolean } = {},
): Promise<void> {
  const startedAt = Date.now();
  store.set(setPreviewRunStateForAppAtom, {
    appId,
    state: { operation: "restart", startedAt },
  });
  store.set(setPreviewAppExitForAppAtom, { appId, exit: null });
  store.set(clearPackageManagerWarningForAppAtom, appId);
  try {
    console.debug(
      "Restarting app",
      appId,
      recreateSandbox ? "with sandbox recreation" : "",
      removeNodeModules ? "with node_modules cleanup" : "",
    );

    store.set(setAppUrlForAppAtom, {
      appId,
      appUrl: { appUrl: null, appId: null, originalUrl: null, mode: null },
    });

    store.set(previewCurrentUrlAtom, (prev) => {
      const next = new Map(prev);
      next.delete(appId);
      return next;
    });

    await ipc.misc.clearLogs({ appId });
    store.set(setConsoleEntriesForAppAtom, { appId, entries: [] });

    const logEntry = {
      level: "info" as const,
      type: "server" as const,
      message: "Restarting app...",
      appId,
      timestamp: startedAt,
    };

    ipc.misc.addLog(logEntry);
    store.set(appendConsoleEntriesForAppAtom, { appId, entries: [logEntry] });

    await ipc.app.restartApp({ appId, removeNodeModules, recreateSandbox });
    store.set(setPreviewErrorForAppAtom, { appId, error: undefined });
  } catch (error) {
    console.error(`Error restarting app ${appId}:`, error);
    store.set(setPreviewErrorForAppAtom, {
      appId,
      error:
        error instanceof Error
          ? { message: error.message, source: "dyad-app" }
          : {
              message: error?.toString() || "Unknown error",
              source: "dyad-app",
            },
    });
  } finally {
    store.set(bumpPreviewReloadTokenForAppAtom, appId);
    store.set(setPreviewRunStateForAppAtom, { appId, state: undefined });
  }
}

export function useRebuildAppAfterPnpmInstall() {
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const setConsoleEntries = useSetAtom(setConsoleEntriesForAppAtom);
  const setAppUrl = useSetAtom(setAppUrlForAppAtom);
  const bumpPreviewReloadToken = useSetAtom(bumpPreviewReloadTokenForAppAtom);
  const setPreservedUrls = useSetAtom(previewCurrentUrlAtom);
  const setPreviewRunState = useSetAtom(setPreviewRunStateForAppAtom);
  const setPreviewAppExit = useSetAtom(setPreviewAppExitForAppAtom);
  const setPreviewError = useSetAtom(setPreviewErrorForAppAtom);

  return useCallback(
    async (appId: number) => {
      const startedAt = Date.now();
      setPreviewRunState({
        appId,
        state: { operation: "restart", startedAt },
      });
      setPreviewAppExit({ appId, exit: null });

      try {
        setAppUrl({
          appId,
          appUrl: { appUrl: null, appId: null, originalUrl: null, mode: null },
        });

        setPreservedUrls((prev) => {
          const next = new Map(prev);
          next.delete(appId);
          return next;
        });

        await ipc.misc.clearLogs({ appId });
        setConsoleEntries({ appId, entries: [] });

        const logEntry = {
          level: "info" as const,
          type: "server" as const,
          message: "Rebuilding app after pnpm install...",
          appId,
          timestamp: startedAt,
        };

        ipc.misc.addLog(logEntry);
        appendConsoleEntries({ appId, entries: [logEntry] });

        await ipc.app.restartApp({
          appId,
          removeNodeModules: true,
          recreateSandbox: false,
        });
        setPreviewError({ appId, error: undefined });
      } catch (error) {
        console.error(`Error rebuilding app ${appId}:`, error);
        setPreviewError({
          appId,
          error:
            error instanceof Error
              ? { message: error.message, source: "dyad-app" }
              : {
                  message: error?.toString() || "Unknown error",
                  source: "dyad-app",
                },
        });
      } finally {
        bumpPreviewReloadToken(appId);
        setPreviewRunState({ appId, state: undefined });
      }
    },
    [
      appendConsoleEntries,
      bumpPreviewReloadToken,
      setAppUrl,
      setConsoleEntries,
      setPreservedUrls,
      setPreviewAppExit,
      setPreviewError,
      setPreviewRunState,
    ],
  );
}

/**
 * Hook to subscribe to app output events from the main process.
 * IMPORTANT: This hook should only be called ONCE in the app (in layout.tsx)
 * to avoid duplicate event subscriptions causing duplicate log entries.
 */
export function useAppOutputSubscription() {
  const { settings } = useSettings();
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const setAppUrl = useSetAtom(setAppUrlForAppAtom);
  const setPreviewError = useSetAtom(setPreviewErrorForAppAtom);
  const setPreviewAppExit = useSetAtom(setPreviewAppExitForAppAtom);
  const setPreviewRunState = useSetAtom(setPreviewRunStateForAppAtom);
  const setPackageManagerWarning = useSetAtom(
    setPackageManagerWarningForAppAtom,
  );
  const bumpPreviewReloadToken = useSetAtom(bumpPreviewReloadTokenForAppAtom);
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
          setAppUrl({
            appId: output.appId,
            appUrl: {
              appUrl: proxyUrl,
              appId: output.appId,
              originalUrl: originalUrl!,
              mode,
            },
          });
          setPreviewRunState({ appId: output.appId, state: undefined });
          bumpPreviewReloadToken(output.appId);
        }
      }
    },
    [bumpPreviewReloadToken, setAppUrl, setPreviewRunState],
  );

  const onHotModuleReload = useCallback(
    (appId: number) => {
      bumpPreviewReloadToken(appId);
    },
    [bumpPreviewReloadToken],
  );

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
        onHotModuleReload(output.appId);
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
      onHotModuleReload,
      processProxyServerOutput,
      setPackageManagerWarning,
      setPreviewAppExit,
      setPreviewError,
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
  const store = useStore();
  const loading = useAtomValue(currentPreviewLoadingAtom);
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const setAppUrl = useSetAtom(setAppUrlForAppAtom);
  const bumpPreviewReloadToken = useSetAtom(bumpPreviewReloadTokenForAppAtom);
  const setPreviewRunState = useSetAtom(setPreviewRunStateForAppAtom);
  const setPreviewAppExit = useSetAtom(setPreviewAppExitForAppAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const setPreviewError = useSetAtom(setPreviewErrorForAppAtom);
  const clearPackageManagerWarning = useSetAtom(
    clearPackageManagerWarningForAppAtom,
  );

  const runApp = useCallback(
    async (appId: number) => {
      const startedAt = Date.now();
      setPreviewRunState({
        appId,
        state: { operation: "run", startedAt },
      });
      setPreviewAppExit({ appId, exit: null });
      clearPackageManagerWarning(appId);
      try {
        console.debug("Running app", appId);

        setAppUrl({
          appId,
          appUrl: { appUrl: null, appId: null, originalUrl: null, mode: null },
        });

        const logEntry = {
          level: "info" as const,
          type: "server" as const,
          message: "Connecting to app...",
          appId,
          timestamp: startedAt,
        };

        ipc.misc.addLog(logEntry);
        appendConsoleEntries({ appId, entries: [logEntry] });
        await ipc.app.runApp({ appId });
        setPreviewError({ appId, error: undefined });
      } catch (error) {
        console.error(`Error running app ${appId}:`, error);
        setPreviewError({
          appId,
          error:
            error instanceof Error
              ? { message: error.message, source: "dyad-app" }
              : {
                  message: error?.toString() || "Unknown error",
                  source: "dyad-app",
                },
        });
      } finally {
        setPreviewRunState({ appId, state: undefined });
      }
    },
    [
      appendConsoleEntries,
      setAppUrl,
      setPreviewAppExit,
      setPreviewError,
      setPreviewRunState,
      clearPackageManagerWarning,
    ],
  );

  const stopApp = useCallback(
    async (appId: number | null) => {
      if (appId === null) {
        return;
      }

      setPreviewRunState({
        appId,
        state: { operation: "stop", startedAt: Date.now() },
      });
      try {
        await ipc.app.stopApp({ appId });
        setPreviewError({ appId, error: undefined });
      } catch (error) {
        console.error(`Error stopping app ${appId}:`, error);
        setPreviewError({
          appId,
          error:
            error instanceof Error
              ? { message: error.message, source: "dyad-app" }
              : {
                  message: error?.toString() || "Unknown error",
                  source: "dyad-app",
                },
        });
      } finally {
        setPreviewRunState({ appId, state: undefined });
      }
    },
    [setPreviewError, setPreviewRunState],
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
      await restartAppWithStore(store, targetAppId, {
        removeNodeModules,
        recreateSandbox,
      });
    },
    [appId, store],
  );

  const refreshAppIframe = useCallback(async () => {
    if (appId === null) {
      return;
    }
    bumpPreviewReloadToken(appId);
  }, [appId, bumpPreviewReloadToken]);

  return {
    loading,
    runApp,
    stopApp,
    restartApp,
    refreshAppIframe,
  };
}
