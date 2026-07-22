import { describe, expect, it } from "vitest";
import { projectFirstPromptState } from "./projection";
import type { FirstPromptPayload } from "./state";

const payload: FirstPromptPayload = {
  prompt: "Build an app",
  attachments: [],
  isChatModeExplicit: false,
};

describe("first-prompt projection", () => {
  it.each(["checkingProviders", "awaitingProviderSetup"] as const)(
    "projects a content-bearing %s payload as armed",
    (type) => {
      const state =
        type === "awaitingProviderSetup"
          ? ({ type, payload, reason: "missing-provider" } as const)
          : ({ type, payload } as const);
      expect(projectFirstPromptState(state)).toEqual({
        phase: type,
        hasArmedPayload: true,
        isExistingAppSubmission: false,
      });
    },
  );

  it("does not arm a manage-only empty payload", () => {
    expect(
      projectFirstPromptState({
        type: "awaitingProviderSetup",
        payload: {
          prompt: "",
          attachments: [],
          isChatModeExplicit: false,
        },
        reason: "manual",
      }),
    ).toEqual({
      phase: "awaitingProviderSetup",
      hasArmedPayload: false,
      isExistingAppSubmission: false,
    });
  });

  it("preserves the actual existing-app path through navigation", () => {
    expect(
      projectFirstPromptState({
        type: "navigating",
        appId: 1,
        chatId: 2,
        isExistingAppSubmission: true,
      }),
    ).toEqual({
      phase: "navigating",
      hasArmedPayload: false,
      isExistingAppSubmission: true,
    });
  });
});
