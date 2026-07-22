import { ignore as ignoreTransition } from "@/state_machines/types";
import type {
  FirstPromptCommand,
  FirstPromptEvent,
  FirstPromptPayload,
  FirstPromptState,
  FirstPromptTransitionResult,
} from "./state";
import { hasPromptContent } from "./state";

function ignore(
  state: FirstPromptState,
  reason: NonNullable<FirstPromptTransitionResult["ignoredReason"]>,
): FirstPromptTransitionResult {
  return ignoreTransition(state, reason);
}

function createCommand(payload: FirstPromptPayload): FirstPromptCommand {
  return payload.selectedApp
    ? { type: "CreateChat", appId: payload.selectedApp.id, payload }
    : { type: "CreateApp", payload };
}

function startCreating(
  payload: FirstPromptPayload,
): FirstPromptTransitionResult {
  return {
    state: { type: "creating", payload },
    commands: [createCommand(payload)],
  };
}

function resumePartial(
  state: Extract<FirstPromptState, { type: "failedPartial" }>,
  payload: FirstPromptPayload = state.payload,
): FirstPromptTransitionResult {
  return {
    state: {
      type: "postCreate",
      payload,
      appId: state.appId,
      appName: state.appName,
      chatId: state.chatId,
      step: state.step,
    },
    commands: [
      state.step === "neon"
        ? {
            type: "RunNeonTemplateHook",
            appId: state.appId,
            appName: state.appName,
          }
        : { type: "ApplyTheme", appId: state.appId },
    ],
  };
}

function startDispatching(
  payload: FirstPromptPayload,
  appId: number,
  chatId: number,
  isExistingAppSubmission: boolean,
): FirstPromptTransitionResult {
  return {
    state: {
      type: "dispatching",
      appId,
      chatId,
      isExistingAppSubmission,
      settled: false,
      previewDecided: false,
    },
    commands: [
      { type: "SubmitPrompt", appId, chatId, payload },
      { type: "ClearEditingBuffer" },
      { type: "ScheduleSettle" },
      { type: "OpenPreviewIfSetupRequired", appId },
    ],
  };
}

function finishDispatching(
  state: Extract<FirstPromptState, { type: "dispatching" }>,
): FirstPromptTransitionResult {
  return {
    state: {
      type: "navigating",
      appId: state.appId,
      chatId: state.chatId,
      isExistingAppSubmission: state.isExistingAppSubmission,
    },
    commands: [{ type: "RefreshQueries", appId: state.appId }],
  };
}

function ignoreEvent(
  state: FirstPromptState,
  event: FirstPromptEvent,
): FirstPromptTransitionResult {
  switch (event.type) {
    case "SUBMIT":
      return ignore(state, "submission-in-flight");
    case "PROVIDER_CONFIGURED":
      return ignore(state, "not-awaiting-setup");
    case "ARM_FOR_SETUP":
    case "DISARM":
    case "PROVIDERS_LOADED":
    case "SETUP_DISMISSED":
    case "APP_CREATED":
    case "CHAT_CREATED":
    case "CREATE_FAILED":
    case "NEON_HOOK_DONE":
    case "POST_CREATE_DONE":
    case "POST_CREATE_FAILED":
    case "SETTLED":
    case "PREVIEW_DECISION":
    case "REFRESHED":
    case "RETRY":
    case "RESET":
      return ignore(state, "invalid-in-current-state");
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}

export function transition(
  state: FirstPromptState,
  event: FirstPromptEvent,
): FirstPromptTransitionResult {
  switch (state.type) {
    case "idle":
      switch (event.type) {
        case "SUBMIT":
          return {
            state: { type: "checkingProviders", payload: event.payload },
            commands: [],
          };
        case "ARM_FOR_SETUP":
          return {
            state: {
              type: "awaitingProviderSetup",
              payload: event.payload,
            },
            commands: [{ type: "ShowSetupDialog" }],
          };
        case "RESET":
        case "DISARM":
          return ignore(state, "invalid-in-current-state");
        default:
          return ignoreEvent(state, event);
      }

    case "checkingProviders":
      switch (event.type) {
        case "PROVIDERS_LOADED":
          return event.anySetup
            ? startCreating(state.payload)
            : {
                state: {
                  type: "awaitingProviderSetup",
                  payload: state.payload,
                },
                commands: [{ type: "ShowSetupDialog" }],
              };
        case "PROVIDER_CONFIGURED":
          if (!hasPromptContent(state.payload)) {
            return { state: { type: "idle" }, commands: [] };
          }
          return {
            ...startCreating(state.payload),
            commands: [{ type: "NavigateHome" }, createCommand(state.payload)],
          };
        case "RESET":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignoreEvent(state, event);
      }

    case "awaitingProviderSetup":
      switch (event.type) {
        case "PROVIDER_CONFIGURED":
          if (!hasPromptContent(state.payload)) {
            return { state: { type: "idle" }, commands: [] };
          }
          return {
            ...startCreating(state.payload),
            commands: [{ type: "NavigateHome" }, createCommand(state.payload)],
          };
        case "SETUP_DISMISSED":
        case "DISARM":
        case "RESET":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignoreEvent(state, event);
      }

    case "creating":
      switch (event.type) {
        case "APP_CREATED":
          return {
            state: {
              type: "postCreate",
              payload: state.payload,
              appId: event.appId,
              appName: event.appName,
              chatId: event.chatId,
              step: "neon",
            },
            commands: [
              {
                type: "RunNeonTemplateHook",
                appId: event.appId,
                appName: event.appName,
              },
            ],
          };
        case "CHAT_CREATED": {
          const appId = state.payload.selectedApp?.id;
          if (appId === undefined)
            return ignore(state, "invalid-in-current-state");
          return startDispatching(state.payload, appId, event.chatId, true);
        }
        case "CREATE_FAILED":
          return {
            state: {
              type: "failed",
              payload: state.payload,
              message: event.message,
            },
            commands: [
              {
                type: "ShowError",
                message: event.message,
                failure: state.payload.selectedApp ? "createChat" : "createApp",
              },
            ],
          };
        case "RESET":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignoreEvent(state, event);
      }

    case "postCreate":
      switch (event.type) {
        case "NEON_HOOK_DONE":
          if (state.step !== "neon")
            return ignore(state, "invalid-in-current-state");
          return {
            state: { ...state, step: "theme" },
            commands: [{ type: "ApplyTheme", appId: state.appId }],
          };
        case "POST_CREATE_DONE":
          return startDispatching(
            state.payload,
            state.appId,
            state.chatId,
            false,
          );
        case "POST_CREATE_FAILED":
          return {
            state: {
              type: "failedPartial",
              payload: state.payload,
              appId: state.appId,
              appName: state.appName,
              chatId: state.chatId,
              message: event.message,
              step: state.step,
            },
            commands: [
              {
                type: "ShowError",
                message: event.message,
                failure: "postCreate",
              },
            ],
          };
        case "RESET":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignoreEvent(state, event);
      }

    case "dispatching":
      switch (event.type) {
        case "SETTLED":
          if (state.settled) return ignore(state, "invalid-in-current-state");
          return state.previewDecided
            ? finishDispatching(state)
            : {
                state: { ...state, settled: true },
                commands: [],
              };
        case "PREVIEW_DECISION":
          if (state.previewDecided)
            return ignore(state, "invalid-in-current-state");
          return state.settled
            ? finishDispatching(state)
            : {
                state: { ...state, previewDecided: true },
                commands: [],
              };
        case "RESET":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignoreEvent(state, event);
      }

    case "navigating":
      switch (event.type) {
        case "REFRESHED":
          return {
            state: { type: "idle" },
            commands: [
              { type: "SelectChat", appId: state.appId, chatId: state.chatId },
            ],
          };
        case "RESET":
          return { state: { type: "idle" }, commands: [] };
        default:
          return ignoreEvent(state, event);
      }

    case "failed":
      switch (event.type) {
        case "SUBMIT":
          return {
            state: { type: "checkingProviders", payload: event.payload },
            commands: [],
          };
        case "RETRY":
          return startCreating(state.payload);
        case "RESET":
        case "DISARM":
          return { state: { type: "idle" }, commands: [] };
        case "PROVIDER_CONFIGURED":
          return ignore(state, "not-awaiting-setup");
        default:
          return ignoreEvent(state, event);
      }

    case "failedPartial":
      switch (event.type) {
        case "SUBMIT":
          return resumePartial(state, event.payload);
        case "RETRY":
          return resumePartial(state);
        case "RESET":
        case "DISARM":
          return { state: { type: "idle" }, commands: [] };
        case "PROVIDER_CONFIGURED":
          return ignore(state, "not-awaiting-setup");
        default:
          return ignoreEvent(state, event);
      }

    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}
