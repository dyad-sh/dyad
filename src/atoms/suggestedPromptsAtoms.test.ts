import { createStore } from "jotai";
import { describe, expect, it } from "vitest";
import { removeChatIdFromAllTrackingAtom } from "./chatAtoms";
import { dismissedSuggestedPromptsByChatIdAtom } from "./suggestedPromptsAtoms";

describe("dismissedSuggestedPromptsByChatIdAtom", () => {
  it("drops a deleted chat's entry and keeps the others", () => {
    const store = createStore();
    store.set(
      dismissedSuggestedPromptsByChatIdAtom,
      new Map([
        [1, 10],
        [2, 20],
      ]),
    );

    store.set(removeChatIdFromAllTrackingAtom, 1);

    expect([...store.get(dismissedSuggestedPromptsByChatIdAtom)]).toEqual([
      [2, 20],
    ]);
  });
});
