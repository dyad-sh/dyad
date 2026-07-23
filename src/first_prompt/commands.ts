import type { Clock, ClockHandle, IdSource } from "@/state_machines/clock";
import type {
  FirstPromptChatMode,
  FirstPromptCommand,
  FirstPromptEvent,
  FirstPromptPayload,
} from "./state";
import type { FirstPromptCommandRunner } from "./controller";

export const PROVIDER_CHECK_TIMEOUT_MS = 10_000;

export function getRequestedChatModeForFirstPrompt(
  payload: FirstPromptPayload,
): FirstPromptPayload["chatMode"] | null {
  return payload.isChatModeExplicit ? payload.chatMode : null;
}

export interface CreatedFirstPromptApp {
  readonly appId: number;
  readonly appName: string;
  readonly chatId: number;
}

export interface FirstPromptDeps {
  createApp(
    operationId: string,
    chatMode?: FirstPromptChatMode,
  ): Promise<CreatedFirstPromptApp>;
  createChat(
    appId: number,
    operationId: string,
    chatMode?: FirstPromptChatMode,
  ): Promise<number>;
  commitCreation(operationId: string): void;
  cancelCreation(operationId: string): void;
  runNeonTemplateHook(appId: number, appName: string): Promise<void>;
  applyTheme(appId: number): Promise<void>;
  openPreviewIfSetupRequired(appId: number): Promise<boolean>;
  submitPrompt(request: {
    appId: number;
    chatId: number;
    payload: FirstPromptPayload;
  }): void;
  refreshQueries(appId: number): Promise<void>;
  navigateHome(): void;
  selectChat(appId: number, chatId: number): void;
  showSetupDialog(): void;
  clearEditingBuffer(): void;
  showError(
    message: string,
    failure: "createApp" | "createChat" | "postCreate",
  ): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createFirstPromptCommandRunner(options: {
  clock: Clock;
  idSource: IdSource;
  getSettleDelayMs: () => number;
  getDeps: () => FirstPromptDeps;
}): FirstPromptCommandRunner {
  const settleHandles = new Set<ClockHandle>();
  let providerCheckHandle: ClockHandle | undefined;
  let disposed = false;
  let ownedCreationOperationId: string | undefined;
  let cancelledCreationOperationId: string | undefined;

  function retryCreationCancellation(deps: FirstPromptDeps): void {
    const operationId =
      ownedCreationOperationId ?? cancelledCreationOperationId;
    if (operationId) deps.cancelCreation(operationId);
  }

  function relinquishOwnedCreation(deps: FirstPromptDeps): void {
    if (!ownedCreationOperationId) return;
    deps.commitCreation(ownedCreationOperationId);
    ownedCreationOperationId = undefined;
    cancelledCreationOperationId = undefined;
  }

  return {
    async run(
      command: FirstPromptCommand,
      emit: (event: FirstPromptEvent) => void,
    ) {
      if (disposed) return;
      const deps = options.getDeps();
      switch (command.type) {
        case "ScheduleProviderCheckTimeout": {
          if (providerCheckHandle !== undefined) {
            options.clock.cancel(providerCheckHandle);
          }
          const handle = options.clock.schedule(() => {
            providerCheckHandle = undefined;
            if (!disposed) emit({ type: "PROVIDER_CHECK_TIMED_OUT" });
          }, PROVIDER_CHECK_TIMEOUT_MS);
          providerCheckHandle = handle;
          return;
        }

        case "CancelProviderCheckTimeout":
          if (providerCheckHandle !== undefined) {
            options.clock.cancel(providerCheckHandle);
            providerCheckHandle = undefined;
          }
          return;

        case "CreateApp": {
          relinquishOwnedCreation(deps);
          const operationId = options.idSource.next("first-prompt-create-app");
          ownedCreationOperationId = operationId;
          try {
            const result = await deps.createApp(
              operationId,
              command.payload.isChatModeExplicit
                ? command.payload.chatMode
                : undefined,
            );
            if (disposed) {
              deps.cancelCreation(operationId);
              ownedCreationOperationId = undefined;
              return;
            }
            emit({
              type: "APP_CREATED",
              appId: result.appId,
              appName: result.appName,
              chatId: result.chatId,
            });
          } catch (error) {
            if (disposed) {
              deps.cancelCreation(operationId);
            } else {
              deps.commitCreation(operationId);
              emit({ type: "CREATE_FAILED", message: errorMessage(error) });
            }
            ownedCreationOperationId = undefined;
          }
          return;
        }

        case "CreateChat": {
          relinquishOwnedCreation(deps);
          const operationId = options.idSource.next("first-prompt-create-chat");
          ownedCreationOperationId = operationId;
          try {
            const chatId = await deps.createChat(
              command.appId,
              operationId,
              command.payload.isChatModeExplicit
                ? command.payload.chatMode
                : undefined,
            );
            if (disposed) {
              deps.cancelCreation(operationId);
              ownedCreationOperationId = undefined;
              return;
            }
            emit({ type: "CHAT_CREATED", chatId });
          } catch (error) {
            if (disposed) {
              deps.cancelCreation(operationId);
            } else {
              deps.commitCreation(operationId);
              emit({ type: "CREATE_FAILED", message: errorMessage(error) });
            }
            ownedCreationOperationId = undefined;
          }
          return;
        }

        case "RunNeonTemplateHook":
          try {
            await deps.runNeonTemplateHook(command.appId, command.appName);
            if (disposed) {
              retryCreationCancellation(deps);
              return;
            }
            emit({ type: "NEON_HOOK_DONE" });
          } catch (error) {
            if (disposed) {
              retryCreationCancellation(deps);
              return;
            }
            emit({ type: "POST_CREATE_FAILED", message: errorMessage(error) });
          }
          return;

        case "ApplyTheme":
          try {
            await deps.applyTheme(command.appId);
            if (disposed) {
              retryCreationCancellation(deps);
              return;
            }
            emit({ type: "POST_CREATE_DONE" });
          } catch (error) {
            if (disposed) {
              retryCreationCancellation(deps);
              return;
            }
            emit({ type: "POST_CREATE_FAILED", message: errorMessage(error) });
          }
          return;

        case "OpenPreviewIfSetupRequired": {
          try {
            const opened = await deps.openPreviewIfSetupRequired(command.appId);
            emit({ type: "PREVIEW_DECISION", opened });
          } catch (error) {
            emit({
              type: "PREVIEW_DECISION_FAILED",
              message: errorMessage(error),
            });
          }
          return;
        }

        case "SubmitPrompt":
          deps.submitPrompt({
            appId: command.appId,
            chatId: command.chatId,
            payload: command.payload,
          });
          relinquishOwnedCreation(deps);
          return;

        case "ScheduleSettle":
          {
            const handle = options.clock.schedule(() => {
              settleHandles.delete(handle);
              if (!disposed) emit({ type: "SETTLED" });
            }, options.getSettleDelayMs());
            settleHandles.add(handle);
          }
          return;

        case "RefreshQueries":
          try {
            await deps.refreshQueries(command.appId);
            emit({ type: "REFRESHED" });
          } catch (error) {
            emit({ type: "REFRESH_FAILED", message: errorMessage(error) });
          }
          return;

        case "NavigateHome":
          deps.navigateHome();
          return;

        case "SelectChat":
          deps.selectChat(command.appId, command.chatId);
          return;

        case "ShowSetupDialog":
          deps.showSetupDialog();
          return;

        case "ClearEditingBuffer":
          deps.clearEditingBuffer();
          return;

        case "ShowError":
          deps.showError(command.message, command.failure);
          return;

        default: {
          const exhaustive: never = command;
          return exhaustive;
        }
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      if (providerCheckHandle !== undefined) {
        options.clock.cancel(providerCheckHandle);
        providerCheckHandle = undefined;
      }
      for (const handle of settleHandles) options.clock.cancel(handle);
      settleHandles.clear();
      if (ownedCreationOperationId) {
        cancelledCreationOperationId = ownedCreationOperationId;
        options.getDeps().cancelCreation(ownedCreationOperationId);
        ownedCreationOperationId = undefined;
      }
    },
  };
}
