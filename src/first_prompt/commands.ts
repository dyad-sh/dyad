import type { Clock, ClockHandle } from "@/state_machines/clock";
import type {
  FirstPromptChatMode,
  FirstPromptCommand,
  FirstPromptEvent,
  FirstPromptPayload,
} from "./state";
import type { FirstPromptCommandRunner } from "./controller";

export interface CreatedFirstPromptApp {
  readonly appId: number;
  readonly appName: string;
  readonly chatId: number;
}

export interface FirstPromptDeps {
  createApp(chatMode?: FirstPromptChatMode): Promise<CreatedFirstPromptApp>;
  createChat(appId: number, chatMode?: FirstPromptChatMode): Promise<number>;
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
  getSettleDelayMs: () => number;
  getDeps: () => FirstPromptDeps;
}): FirstPromptCommandRunner {
  const settleHandles = new Set<ClockHandle>();
  let disposed = false;

  return {
    async run(
      command: FirstPromptCommand,
      emit: (event: FirstPromptEvent) => void,
    ) {
      if (disposed) return;
      const deps = options.getDeps();
      switch (command.type) {
        case "CreateApp":
          try {
            const result = await deps.createApp(command.payload.chatMode);
            emit({
              type: "APP_CREATED",
              appId: result.appId,
              appName: result.appName,
              chatId: result.chatId,
            });
          } catch (error) {
            emit({ type: "CREATE_FAILED", message: errorMessage(error) });
          }
          return;

        case "CreateChat":
          try {
            const chatId = await deps.createChat(
              command.appId,
              command.payload.chatMode,
            );
            emit({ type: "CHAT_CREATED", chatId });
          } catch (error) {
            emit({ type: "CREATE_FAILED", message: errorMessage(error) });
          }
          return;

        case "RunNeonTemplateHook":
          try {
            await deps.runNeonTemplateHook(command.appId, command.appName);
            emit({ type: "NEON_HOOK_DONE" });
          } catch (error) {
            emit({ type: "POST_CREATE_FAILED", message: errorMessage(error) });
          }
          return;

        case "ApplyTheme":
          try {
            await deps.applyTheme(command.appId);
            emit({ type: "POST_CREATE_DONE" });
          } catch (error) {
            emit({ type: "POST_CREATE_FAILED", message: errorMessage(error) });
          }
          return;

        case "OpenPreviewIfSetupRequired": {
          try {
            const opened = await deps.openPreviewIfSetupRequired(command.appId);
            emit({ type: "PREVIEW_DECISION", opened });
          } catch (error) {
            deps.showError(errorMessage(error), "postCreate");
            emit({ type: "PREVIEW_DECISION", opened: false });
          }
          return;
        }

        case "SubmitPrompt":
          deps.submitPrompt({
            appId: command.appId,
            chatId: command.chatId,
            payload: command.payload,
          });
          return;

        case "ScheduleSettle":
          await new Promise<void>((resolve) => {
            const handle = options.clock.schedule(() => {
              settleHandles.delete(handle);
              if (!disposed) emit({ type: "SETTLED" });
              resolve();
            }, options.getSettleDelayMs());
            settleHandles.add(handle);
          });
          return;

        case "RefreshQueries":
          try {
            await deps.refreshQueries(command.appId);
          } catch (error) {
            deps.showError(errorMessage(error), "postCreate");
          }
          emit({ type: "REFRESHED" });
          return;

        case "NavigateHome":
          deps.navigateHome();
          return;

        case "SelectChat":
          try {
            deps.selectChat(command.appId, command.chatId);
          } catch (error) {
            deps.showError(errorMessage(error), "postCreate");
          }
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
      for (const handle of settleHandles) options.clock.cancel(handle);
      settleHandles.clear();
    },
  };
}
