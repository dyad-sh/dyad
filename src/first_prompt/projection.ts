import { atom } from "jotai";
import type { FirstPromptState } from "./state";
import { hasPromptContent } from "./state";

export type FirstPromptPhase = FirstPromptState["type"];

export interface FirstPromptSagaProjection {
  readonly phase: FirstPromptPhase;
  readonly hasArmedPayload: boolean;
}

export const IDLE_FIRST_PROMPT_PROJECTION: FirstPromptSagaProjection = {
  phase: "idle",
  hasArmedPayload: false,
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
  return {
    phase: state.type,
    hasArmedPayload:
      (state.type === "checkingProviders" ||
        state.type === "awaitingProviderSetup") &&
      hasPromptContent(state.payload),
  };
}
