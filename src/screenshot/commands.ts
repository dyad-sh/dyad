import type { QueryClient } from "@tanstack/react-query";
import { ipc } from "@/ipc/types";
import { queryKeys } from "@/lib/queryKeys";
import type { Clock, IdSource } from "@/state_machines/clock";
import { TaskScope } from "@/state_machines/task_scope";
import { TimerLeaseScope } from "@/state_machines/timer_lease";
import type { ScreenshotCommandRunner } from "./controller";
import type { ScreenshotEvent, ScreenshotState } from "./state";

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
  const settleLeases = new TimerLeaseScope<number, string, ScreenshotEvent>(
    options.clock,
  );
  const attachments = new TaskScope<number>();
  const postMessages = new Map<number, ScreenshotPostMessage>();

  const cancelSettle = (appId: number) => {
    settleLeases.remove(appId);
  };

  return {
    attach(appId, postMessage) {
      postMessages.set(appId, postMessage);
      attachments.replace(appId, () => {
        if (postMessages.get(appId) === postMessage) postMessages.delete(appId);
      });
      return () => {
        if (postMessages.get(appId) === postMessage) attachments.remove(appId);
      };
    },
    execute(appId, command, emit) {
      switch (command.type) {
        case "schedule-settle":
          settleLeases.replace(
            appId,
            command.settleToken ?? "legacy-untagged-settle",
            SCREENSHOT_SETTLE_DELAY_MS,
            (settleToken) => ({
              type: "SETTLE_ELAPSED",
              requestId: options.idSource.next("screenshot-capture"),
              settleToken,
            }),
            emit,
          );
          return;
        case "cancel-settle":
          cancelSettle(appId);
          return;
        case "resolve-commit-hash":
          void ipc.app.getCurrentCommitHash({ appId }).then(
            ({ commitHash }) => {
              if (!commitHash) {
                emit({
                  type: "SAVE_FAILED",
                  requestId: command.requestId,
                });
                return;
              }
              emit({
                type: "COMMIT_RESOLVED",
                hash: commitHash,
                requestId: command.requestId,
              });
            },
            (error) => {
              console.warn(
                "Failed to resolve commit hash for screenshot",
                error,
              );
              emit({
                type: "SAVE_FAILED",
                requestId: command.requestId,
              });
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
    beforeStateCommit(appId, previous, next) {
      if (
        ownsSettleLease(previous) &&
        (!ownsSettleLease(next) || next.settleToken !== previous.settleToken)
      ) {
        cancelSettle(appId);
      }
    },
    disposeKey(appId) {
      cancelSettle(appId);
      attachments.remove(appId);
    },
  };
}

function ownsSettleLease(
  state: ScreenshotState,
): state is Extract<
  ScreenshotState,
  { status: "waitingSelectorReady" | "settling" }
> {
  return state.status === "waitingSelectorReady" || state.status === "settling";
}

function assertNever(value: never): never {
  throw new Error(`Unexpected screenshot command: ${JSON.stringify(value)}`);
}
