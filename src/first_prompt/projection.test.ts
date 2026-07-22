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
    });
  });
});
