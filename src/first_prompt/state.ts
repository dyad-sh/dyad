/**
 * Domain model for the home first-prompt saga.
 *
 * Machine dependency graph: first_prompt -> chat-stream facade (injected at
 * the application composition root). No machine module imports chat_stream.
 *
 * Deliberate plan deviation: APP_CREATED and the post-create/partial-failure
 * states retain appName and the current post-create step so RETRY can resume
 * the failed side effect against the existing app without creating a second
 * app or repeating a completed Neon hook. NEON_HOOK_DONE is an internal
 * sequencing event that keeps RunNeonTemplateHook and ApplyTheme as separate
 * commands. dispatching also retains the submission target plus settle/preview
 * completion flags so the UI preserves its existing-app copy while those
 * independent operations preserve current-main concurrency and join
 * deterministically before navigation.
 */

export type FirstPromptChatMode = "build" | "ask" | "local-agent" | "plan";

export interface FirstPromptAttachment {
  readonly file: File;
  readonly type: "chat-context" | "upload-to-codebase";
}

export interface FirstPromptSelectedApp {
  readonly id: number;
  readonly name: string;
}

export interface FirstPromptPayload {
  readonly prompt: string;
  readonly attachments: readonly FirstPromptAttachment[];
  readonly selectedApp?: FirstPromptSelectedApp;
  readonly chatMode?: FirstPromptChatMode;
  readonly isChatModeExplicit: boolean;
}

export type FirstPromptState =
  | { readonly type: "idle" }
  | { readonly type: "checkingProviders"; readonly payload: FirstPromptPayload }
  | {
      readonly type: "awaitingProviderSetup";
      readonly payload: FirstPromptPayload;
    }
  | { readonly type: "creating"; readonly payload: FirstPromptPayload }
  | {
      readonly type: "postCreate";
      readonly payload: FirstPromptPayload;
      readonly appId: number;
      readonly appName: string;
      readonly chatId: number;
      readonly step: "neon" | "theme";
    }
  | {
      readonly type: "dispatching";
      readonly appId: number;
      readonly chatId: number;
      readonly isExistingAppSubmission: boolean;
      readonly settled: boolean;
      readonly previewDecided: boolean;
    }
  | {
      readonly type: "navigating";
      readonly appId: number;
      readonly chatId: number;
      readonly isExistingAppSubmission: boolean;
    }
  | {
      readonly type: "failed";
      readonly payload: FirstPromptPayload;
      readonly message: string;
    }
  | {
      readonly type: "failedPartial";
      readonly payload: FirstPromptPayload;
      readonly appId: number;
      readonly appName: string;
      readonly chatId: number;
      readonly message: string;
      readonly step: "neon" | "theme";
    };

export type FirstPromptEvent =
  | { readonly type: "SUBMIT"; readonly payload: FirstPromptPayload }
  | { readonly type: "ARM_FOR_SETUP"; readonly payload: FirstPromptPayload }
  | { readonly type: "DISARM" }
  | { readonly type: "PROVIDERS_LOADED"; readonly anySetup: boolean }
  | {
      readonly type: "PROVIDER_CONFIGURED";
      readonly defaultChatMode?: FirstPromptChatMode;
    }
  | { readonly type: "SETUP_DISMISSED" }
  | {
      readonly type: "APP_CREATED";
      readonly appId: number;
      readonly appName: string;
      readonly chatId: number;
    }
  | { readonly type: "CHAT_CREATED"; readonly chatId: number }
  | { readonly type: "CREATE_FAILED"; readonly message: string }
  | { readonly type: "NEON_HOOK_DONE" }
  | { readonly type: "POST_CREATE_DONE" }
  | { readonly type: "POST_CREATE_FAILED"; readonly message: string }
  | { readonly type: "SETTLED" }
  | { readonly type: "PREVIEW_DECISION"; readonly opened: boolean }
  | { readonly type: "REFRESHED" }
  | { readonly type: "RETRY" }
  | { readonly type: "RESET" };

export type FirstPromptCommand =
  | { readonly type: "CreateApp"; readonly payload: FirstPromptPayload }
  | {
      readonly type: "CreateChat";
      readonly appId: number;
      readonly payload: FirstPromptPayload;
    }
  | {
      readonly type: "RunNeonTemplateHook";
      readonly appId: number;
      readonly appName: string;
    }
  | { readonly type: "ApplyTheme"; readonly appId: number }
  | { readonly type: "OpenPreviewIfSetupRequired"; readonly appId: number }
  | {
      readonly type: "SubmitPrompt";
      readonly appId: number;
      readonly chatId: number;
      readonly payload: FirstPromptPayload;
    }
  | { readonly type: "ScheduleSettle" }
  | { readonly type: "RefreshQueries"; readonly appId: number }
  | { readonly type: "NavigateHome" }
  | {
      readonly type: "SelectChat";
      readonly appId: number;
      readonly chatId: number;
    }
  | { readonly type: "ShowSetupDialog" }
  | { readonly type: "ClearEditingBuffer" }
  | {
      readonly type: "ShowError";
      readonly message: string;
      readonly failure: "createApp" | "createChat" | "postCreate";
    };

export type FirstPromptIgnoreReason =
  | "submission-in-flight"
  | "not-awaiting-setup"
  | "invalid-in-current-state";

export type FirstPromptTransitionResult =
  import("@/state_machines/types").TransitionResult<
    FirstPromptState,
    FirstPromptCommand,
    FirstPromptIgnoreReason
  >;

export function hasPromptContent(payload: FirstPromptPayload): boolean {
  return payload.prompt.trim().length > 0 || payload.attachments.length > 0;
}
