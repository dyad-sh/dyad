import { useCallback, useEffect, useRef } from "react";
import { ipc, type AppOutput } from "@/ipc/types";
import { selectedAppIdAtom } from "@/atoms/appAtoms";
import {
  appendConsoleEntriesForAppAtom,
  bumpPreviewReloadTokenForAppAtom,
  currentPreviewLoadingAtom,
  previewCurrentUrlAtom,
  previewErrorByAppIdAtom,
  setAppUrlForAppAtom,
  setConsoleEntriesForAppAtom,
  setPreviewAppExitForAppAtom,
  setPreviewErrorForAppAtom,
  setPreviewRunStateForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import { useAtomValue, useSetAtom } from "jotai";
import {
  showError,
  showInputRequest,
  showPnpmMinimumReleaseAgeWarning,
} from "@/lib/toast";
import {
  shouldShowPnpmMinimumReleaseAgeWarning,
  type RuntimeMode2,
  type UserSettings,
} from "@/lib/schemas";
import { useSettings } from "./useSettings";

const CLOUD_SYNC_ERROR_TOAST_WINDOW_MS = 30_000;

type UpdateSettings = (newSettings: Partial<UserSettings>) => Promise<unknown>;

export function showPnpmMinimumReleaseAgeWarningToast({
  message,
  onInstallPnpm,
  updateSettings,
}: {
  message: string;
  onInstallPnpm: () => Promise<void>;
  updateSettings: UpdateSettings;
}) {
  showPnpmMinimumReleaseAgeWarning({
    message,
    onInstallPnpm,
    onOpenDocs: () => {
      void ipc.system.openExternalUrl("https://pnpm.io/installation");
    },
    onNeverShowAgain: () => {
      void updateSettings({
        hidePnpmMinimumReleaseAgeWarning: true,
      });
    },
  });
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
          const next = { ...prev };
          delete next[appId];
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
  const { settings, updateSettings } = useSettings();
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const setAppUrl = useSetAtom(setAppUrlForAppAtom);
  const setPreviewErrorByAppId = useSetAtom(previewErrorByAppIdAtom);
  const setPreviewAppExit = useSetAtom(setPreviewAppExitForAppAtom);
  const bumpPreviewReloadToken = useSetAtom(bumpPreviewReloadTokenForAppAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const selectedAppIdRef = useRef(appId);
  const rebuildAppAfterPnpmInstall = useRebuildAppAfterPnpmInstall();
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
        }
      }
    },
    [setAppUrl],
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

        setPreviewErrorByAppId((prev) => {
          const current = prev.get(output.appId);
          if (current && current.source !== "dyad-sync") {
            return prev;
          }
          const next = new Map(prev);
          next.set(output.appId, {
            message: output.message,
            source: "dyad-sync",
          });
          return next;
        });
      }

      if (output.type === "sync-recovered") {
        syncErrorToastRef.current.delete(output.appId);
        setPreviewErrorByAppId((prev) => {
          if (prev.get(output.appId)?.source !== "dyad-sync") {
            return prev;
          }
          const next = new Map(prev);
          next.delete(output.appId);
          return next;
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
        pnpmWarningSettingRef.current.hasSettings &&
        pnpmWarningSettingRef.current.showWarning
      ) {
        showPnpmMinimumReleaseAgeWarningToast({
          message: output.message,
          onInstallPnpm: async () => {
            await ipc.system.installPnpm();
            await rebuildAppAfterPnpmInstall(output.appId);
          },
          updateSettings,
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
      rebuildAppAfterPnpmInstall,
      setPreviewAppExit,
      setPreviewErrorByAppId,
      updateSettings,
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
  const loading = useAtomValue(currentPreviewLoadingAtom);
  const appendConsoleEntries = useSetAtom(appendConsoleEntriesForAppAtom);
  const setConsoleEntries = useSetAtom(setConsoleEntriesForAppAtom);
  const setAppUrl = useSetAtom(setAppUrlForAppAtom);
  const bumpPreviewReloadToken = useSetAtom(bumpPreviewReloadTokenForAppAtom);
  const setPreservedUrls = useSetAtom(previewCurrentUrlAtom);
  const setPreviewRunState = useSetAtom(setPreviewRunStateForAppAtom);
  const setPreviewAppExit = useSetAtom(setPreviewAppExitForAppAtom);
  const appId = useAtomValue(selectedAppIdAtom);
  const setPreviewError = useSetAtom(setPreviewErrorForAppAtom);

  const runApp = useCallback(
    async (appId: number) => {
      const startedAt = Date.now();
      setPreviewRunState({
        appId,
        state: { operation: "run", startedAt },
      });
      setPreviewAppExit({ appId, exit: null });
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
      removeNodeModules = false,
      recreateSandbox = false,
    }: { removeNodeModules?: boolean; recreateSandbox?: boolean } = {}) => {
      if (appId === null) {
        return;
      }
      const startedAt = Date.now();
      setPreviewRunState({
        appId,
        state: { operation: "restart", startedAt },
      });
      setPreviewAppExit({ appId, exit: null });
      try {
        console.debug(
          "Restarting app",
          appId,
          recreateSandbox ? "with sandbox recreation" : "",
          removeNodeModules ? "with node_modules cleanup" : "",
        );

        setAppUrl({
          appId,
          appUrl: { appUrl: null, appId: null, originalUrl: null, mode: null },
        });

        setPreservedUrls((prev) => {
          const next = { ...prev };
          delete next[appId];
          return next;
        });

        await ipc.misc.clearLogs({ appId });
        setConsoleEntries({ appId, entries: [] });

        const logEntry = {
          level: "info" as const,
          type: "server" as const,
          message: "Restarting app...",
          appId,
          timestamp: startedAt,
        };

        ipc.misc.addLog(logEntry);
        appendConsoleEntries({ appId, entries: [logEntry] });

        await ipc.app.restartApp({ appId, removeNodeModules, recreateSandbox });
        setPreviewError({ appId, error: undefined });
      } catch (error) {
        console.error(`Error restarting app ${appId}:`, error);
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
      appId,
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
