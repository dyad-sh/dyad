import type { QueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { Clock, ClockHandle, IdSource } from "@/state_machines/clock";
import type { ScreenshotCommandRunner } from "./controller";

export const SCREENSHOT_SETTLE_DELAY_MS = 3_000;

export type ScreenshotPostMessage = (message: {
  type: "dyad-take-screenshot";
  requestId: string;
}) => void;

export interface ScreenshotCommandAdapter extends ScreenshotCommandRunner {
  attach(appId: number, postMessage: ScreenshotPostMessage): () => void;
}

export function createScreenshotCommandAdapter(options: {
  clock: Clock;
  idSource: IdSource;
  queryClient: QueryClient;
}): ScreenshotCommandAdapter {
  const settleTimers = new Map<number, ClockHandle>();
  const postMessages = new Map<number, ScreenshotPostMessage>();

  const cancelSettle = (appId: number) => {
    const handle = settleTimers.get(appId);
    if (handle === undefined) return;
    options.clock.cancel(handle);
    settleTimers.delete(appId);
  };

  return {
    attach(appId, postMessage) {
      postMessages.set(appId, postMessage);
      return () => {
        if (postMessages.get(appId) === postMessage) postMessages.delete(appId);
      };
    },
    execute(appId, command, emit) {
      switch (command.type) {
        case "schedule-settle":
          cancelSettle(appId);
          settleTimers.set(
            appId,
            options.clock.schedule(() => {
              settleTimers.delete(appId);
              emit({ type: "SETTLE_ELAPSED" });
            }, SCREENSHOT_SETTLE_DELAY_MS),
          );
          return;
        case "cancel-settle":
          cancelSettle(appId);
          return;
        case "resolve-commit-hash":
          void ipc.app.getCurrentCommitHash({ appId }).then(
            ({ commitHash }) => {
              if (!commitHash) {
                emit({ type: "SAVE_FAILED" });
                return;
              }
              emit({
                type: "COMMIT_RESOLVED",
                hash: commitHash,
                requestId: options.idSource.next("screenshot-capture"),
              });
            },
            (error) => {
              console.warn(
                "Failed to resolve commit hash for screenshot",
                error,
              );
              emit({ type: "SAVE_FAILED" });
            },
          );
          return;
        case "post-capture-request":
          postMessages.get(appId)?.({
            type: "dyad-take-screenshot",
            requestId: command.requestId,
          });
          return;
        case "save-screenshot":
          void ipc.app
            .saveAppScreenshot({
              appId,
              dataUrl: command.dataUrl,
              commitHash: command.commitHash,
            })
            .then(() =>
              options.queryClient.invalidateQueries({
                queryKey: queryKeys.apps.screenshots({ appId }),
              }),
            )
            .then(() =>
              options.queryClient.invalidateQueries({
                queryKey: queryKeys.apps.thumbnails,
              }),
            )
            .then(
              () => emit({ type: "SAVED" }),
              (error) => {
                console.error("Failed to save app screenshot:", error);
                emit({ type: "SAVE_FAILED" });
              },
            );
          return;
        case "check-existing-screenshots":
          void ipc.app.listAppScreenshots({ appId }).then(
            ({ screenshots }) => {
              if (screenshots.length === 0) {
                emit({ type: "CAPTURE_REQUESTED", source: "fallback" });
              }
            },
            () => undefined,
          );
          return;
        default:
          return assertNever(command);
      }
    },
    disposeKey(appId) {
      cancelSettle(appId);
      postMessages.delete(appId);
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unexpected screenshot command: ${JSON.stringify(value)}`);
}
