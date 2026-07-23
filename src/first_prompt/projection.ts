import { atom } from "jotai";
import type { FirstPromptState } from "./state";
import { hasPromptContent } from "./state";

export type FirstPromptPhase = FirstPromptState["type"];

export interface FirstPromptSagaProjection {
  readonly phase: FirstPromptPhase;
  readonly hasArmedPayload: boolean;
  readonly isExistingAppSubmission: boolean;
}

export const IDLE_FIRST_PROMPT_PROJECTION: FirstPromptSagaProjection = {
  phase: "idle",
  hasArmedPayload: false,
  isExistingAppSubmission: false,
};

export const firstPromptSagaProjectionWriteAtom =
  atom<FirstPromptSagaProjection>(IDLE_FIRST_PROMPT_PROJECTION);
firstPromptSagaProjectionWriteAtom.debugLabel =
  "firstPromptSagaProjectionWriteAtom";

export const firstPromptSagaAtom = atom((get) =>
  get(firstPromptSagaProjectionWriteAtom),
);
firstPromptSagaAtom.debugLabel = "firstPromptSagaAtom";

export function projectFirstPromptState(
  state: FirstPromptState,
): FirstPromptSagaProjection {
  const isExistingAppSubmission = (() => {
    switch (state.type) {
      case "checkingProviders":
      case "awaitingProviderSetup":
      case "creating":
      case "failed":
        return state.payload.selectedApp !== undefined;
      case "dispatching":
      case "navigating":
        return state.isExistingAppSubmission;
      case "idle":
      case "postCreate":
      case "failedPartial":
        return false;
      default: {
        const exhaustive: never = state;
        return exhaustive;
      }
    }
  })();

  return {
    phase: state.type,
    hasArmedPayload:
      (state.type === "checkingProviders" ||
        state.type === "awaitingProviderSetup") &&
      hasPromptContent(state.payload),
    isExistingAppSubmission,
  };
}
