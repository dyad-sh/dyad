import { describe, expect, it } from "vitest";
import { projectFirstPromptState } from "./projection";
import type { FirstPromptPayload } from "./state";

const payload: FirstPromptPayload = {
  prompt: "Build an app",
  attachments: [],
};

describe("first-prompt projection", () => {
  it.each(["checkingProviders", "awaitingProviderSetup"] as const)(
    "projects a content-bearing %s payload as armed",
    (type) => {
      expect(projectFirstPromptState({ type, payload })).toEqual({
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
        payload: { prompt: "", attachments: [] },
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
