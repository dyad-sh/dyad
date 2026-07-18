import type { createStore } from "jotai";
import { ipc } from "@/ipc/types";
import {
  EMPTY_APP_URL,
  appendConsoleEntriesForAppAtom,
  bumpPreviewReloadTokenForAppAtom,
  clearPackageManagerWarningForAppAtom,
  previewCurrentUrlAtom,
  setAppUrlForAppAtom,
  setConsoleEntriesForAppAtom,
  setPreviewAppExitForAppAtom,
  setPreviewErrorForAppAtom,
} from "@/atoms/previewRuntimeAtoms";
import type { RunCommand, RunErrorInfo, RunEvent, RunOperation } from "./state";

export type JotaiStore = ReturnType<typeof createStore>;

export type RunEventSink = (event: RunEvent) => void;

/**
 * Executes a single machine command. Implementations report async
 * completions (IPC settlement, reload done) by emitting events through
 * `emit` rather than by mutating state directly.
 *
 * The returned promise resolves when the command has been *issued* (all
 * synchronous side effects applied and any IPC call fired), NOT when the
 * IPC call settles — settlement arrives as an event. This keeps the
 * controller's serial queue from blocking behind a slow run/stop IPC, so a
 * superseding operation's effects aren't delayed by its predecessor.
 */
export interface RunCommandExecutor {
  execute(command: RunCommand, emit: RunEventSink): Promise<void>;
}

const START_LOG_MESSAGE: Record<RunOperation, string> = {
  run: "Connecting to app...",
  restart: "Restarting app...",
  rebuild: "Rebuilding app after pnpm install...",
};

export function toRunErrorInfo(error: unknown): RunErrorInfo {
  return {
    message:
      error instanceof Error
        ? error.message
        : error?.toString() || "Unknown error",
  };
}

/**
 * Production adapter: applies commands to the Jotai preview-runtime atoms
 * and the app IPC surface, preserving the side-effect ordering the old
 * copy-pasted run/restart/rebuild/stop bodies had.
 */
export function createIpcRunCommandExecutor(
  store: JotaiStore,
): RunCommandExecutor {
  function setError(appId: number, error: RunErrorInfo | undefined) {
    store.set(setPreviewErrorForAppAtom, {
      appId,
      error: error ? { message: error.message, source: "dyad-app" } : undefined,
    });
  }

  function applyUrl(command: Extract<RunCommand, { type: "applyUrl" }>) {
    store.set(setAppUrlForAppAtom, {
      appId: command.appId,
      appUrl: {
        appUrl: command.url.appUrl,
        appId: command.appId,
        originalUrl: command.url.originalUrl,
        mode: command.url.mode,
      },
    });
    store.set(bumpPreviewReloadTokenForAppAtom, command.appId);
  }

  async function executeStart(
    command: Extract<RunCommand, { type: "start" }>,
    emit: RunEventSink,
  ) {
    const { appId, runId, operation, startedAt, options } = command;
    try {
      console.debug(
        operation === "run" ? "Running app" : "Restarting app",
        appId,
        options.recreateSandbox ? "with sandbox recreation" : "",
        options.removeNodeModules ? "with node_modules cleanup" : "",
      );

      store.set(setPreviewAppExitForAppAtom, { appId, exit: null });
      if (operation !== "rebuild") {
        // The pnpm rebuild flow keeps its banner visible while rebuilding.
        store.set(clearPackageManagerWarningForAppAtom, appId);
      }
      store.set(setAppUrlForAppAtom, { appId, appUrl: EMPTY_APP_URL });

      if (operation !== "run") {
        store.set(previewCurrentUrlAtom, (prev) => {
          const next = new Map(prev);
          next.delete(appId);
          return next;
        });
        await ipc.misc.clearLogs({ appId });
        store.set(setConsoleEntriesForAppAtom, { appId, entries: [] });
      }

      const logEntry = {
        level: "info" as const,
        type: "server" as const,
        message: START_LOG_MESSAGE[operation],
        appId,
        timestamp: startedAt,
      };
      ipc.misc.addLog(logEntry);
      store.set(appendConsoleEntriesForAppAtom, { appId, entries: [logEntry] });

      const ipcCall =
        operation === "run"
          ? ipc.app.runApp({ appId })
          : ipc.app.restartApp({
              appId,
              removeNodeModules: options.removeNodeModules,
              recreateSandbox: options.recreateSandbox,
            });
      // Deliberately not awaited: settlement is reported as an event so the
      // controller's command queue never blocks behind a slow spawn.
      ipcCall.then(
        () => emit({ type: "RUN_IPC_RESOLVED", runId }),
        (error) => {
          console.error(
            `Error ${operation === "run" ? "running" : "restarting"} app ${appId}:`,
            error,
          );
          emit({ type: "RUN_IPC_FAILED", runId, error: toRunErrorInfo(error) });
        },
      );
    } catch (error) {
      // Prelude failure (e.g. clearLogs): settle the operation as failed.
      console.error(`Error starting app ${appId}:`, error);
      emit({ type: "RUN_IPC_FAILED", runId, error: toRunErrorInfo(error) });
    }
  }

  return {
    async execute(command, emit) {
      switch (command.type) {
        case "start":
          await executeStart(command, emit);
          return;
        case "stop":
          ipc.app.stopApp({ appId: command.appId }).then(
            () => emit({ type: "STOP_IPC_RESOLVED", runId: command.runId }),
            (error) => {
              console.error(`Error stopping app ${command.appId}:`, error);
              emit({
                type: "STOP_IPC_FAILED",
                runId: command.runId,
                error: toRunErrorInfo(error),
              });
            },
          );
          return;
        case "applyUrl":
          applyUrl(command);
          return;
        case "bumpReloadToken":
          store.set(bumpPreviewReloadTokenForAppAtom, command.appId);
          return;
        case "reload":
          store.set(bumpPreviewReloadTokenForAppAtom, command.appId);
          emit({ type: "RELOAD_DONE", runId: command.runId });
          return;
        case "clearError":
          setError(command.appId, undefined);
          return;
        case "setError":
          setError(command.appId, command.error);
          return;
        default:
          assertNeverCommand(command);
      }
    },
  };
}

function assertNeverCommand(command: never): never {
  throw new Error(`Unexpected command: ${JSON.stringify(command)}`);
}
