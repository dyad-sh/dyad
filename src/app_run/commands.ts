import type { createStore } from "jotai";
import { ipc } from "@/ipc/types";
import {
  appendConsoleEntriesForAppAtom,
  clearPackageManagerWarningForAppAtom,
  setConsoleEntriesForAppAtom,
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
 * Production adapter: applies remaining preview UI side effects, invokes the
 * app IPC surface, and signals manager-owned reload-token bumps while
 * preserving the old run/restart/rebuild/stop ordering.
 */
export function createIpcRunCommandExecutor(
  store: JotaiStore,
  options: { onReloadTokenBumped: (appId: number) => void },
): RunCommandExecutor {
  function setError(appId: number, error: RunErrorInfo | undefined) {
    store.set(setPreviewErrorForAppAtom, {
      appId,
      error: error ? { message: error.message, source: "dyad-app" } : undefined,
    });
  }

  function applyUrl(command: Extract<RunCommand, { type: "applyUrl" }>) {
    // The URL was committed to RunState before this command was scheduled.
    // Preserve the legacy bump-after-url ordering for iframe remounts.
    options.onReloadTokenBumped(command.appId);
  }

  async function executeStart(
    command: Extract<RunCommand, { type: "start" }>,
    emit: RunEventSink,
  ) {
    const { appId, invocationRef, operation, startedAt, options } = command;
    try {
      console.debug(
        operation === "run" ? "Running app" : "Restarting app",
        appId,
        options.recreateSandbox ? "with sandbox recreation" : "",
        options.removeNodeModules ? "with node_modules cleanup" : "",
      );

      if (operation !== "rebuild") {
        // The pnpm rebuild flow keeps its banner visible while rebuilding.
        store.set(clearPackageManagerWarningForAppAtom, appId);
      }
      if (operation !== "run") {
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
          ? ipc.app.runApp({ appId, invocationRef })
          : ipc.app.restartApp({
              appId,
              invocationRef,
              removeNodeModules: options.removeNodeModules,
              recreateSandbox: options.recreateSandbox,
            });
      // Deliberately not awaited: settlement is reported as an event so the
      // controller's command queue never blocks behind a slow spawn.
      Promise.resolve(ipcCall).then(
        () => emit({ type: "RUN_IPC_RESOLVED", invocationRef }),
        (error) => {
          console.error(
            `Error ${operation === "run" ? "running" : "restarting"} app ${appId}:`,
            error,
          );
          emit({
            type: "RUN_IPC_FAILED",
            invocationRef,
            error: toRunErrorInfo(error),
          });
        },
      );
    } catch (error) {
      // Prelude failure (e.g. clearLogs): settle the operation as failed.
      console.error(`Error starting app ${appId}:`, error);
      emit({
        type: "RUN_IPC_FAILED",
        invocationRef,
        error: toRunErrorInfo(error),
      });
    }
  }

  return {
    async execute(command, emit) {
      switch (command.type) {
        case "start":
          await executeStart(command, emit);
          return;
        case "prepareExternalStart":
          store.set(setConsoleEntriesForAppAtom, {
            appId: command.appId,
            entries: [],
          });
          return;
        case "stop":
          // Mirrors executeStart: a synchronous throw from the IPC surface
          // must still settle the operation, otherwise the machine would be
          // stuck in `stopping` with an unresolved dispatch promise.
          try {
            Promise.resolve(
              ipc.app.stopApp({
                appId: command.appId,
              }),
            ).then(
              () =>
                emit({
                  type: "STOP_IPC_RESOLVED",
                  invocationRef: command.invocationRef,
                }),
              (error) => {
                console.error(`Error stopping app ${command.appId}:`, error);
                emit({
                  type: "STOP_IPC_FAILED",
                  invocationRef: command.invocationRef,
                  error: toRunErrorInfo(error),
                });
              },
            );
          } catch (error) {
            console.error(`Error stopping app ${command.appId}:`, error);
            emit({
              type: "STOP_IPC_FAILED",
              invocationRef: command.invocationRef,
              error: toRunErrorInfo(error),
            });
          }
          return;
        case "applyUrl":
          applyUrl(command);
          return;
        case "bumpReloadToken":
          options.onReloadTokenBumped(command.appId);
          return;
        case "reload":
          options.onReloadTokenBumped(command.appId);
          emit({
            type: "RELOAD_DONE",
            invocationRef: command.invocationRef,
          });
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
