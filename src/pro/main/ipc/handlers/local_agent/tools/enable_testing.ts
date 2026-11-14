import { z } from "zod";
import { userInputRegistry } from "@/user_input/main";
import { ENABLE_TESTING_FOLLOW_UP_PROMPT } from "@/user_input/transition";
import { type ToolDefinition, escapeXmlAttr } from "./types";

export const enableTestingTool: ToolDefinition<Record<string, never>> = {
  name: "enable_testing",
  description:
    "Ask the user to enable Dyad E2E testing when they request adding, writing, or running tests (including a general request for tests) and testing is disabled. Call this before creating test files, installing test frameworks, or delegating test work. Shows an Enable testing / Not now card and waits for the user's decision. After either choice, Dyad resumes the task in a fresh turn with the appropriate testing tools and conventions. Do not call again after a decline unless the user explicitly asks to enable testing.",
  inputSchema: z.object({}),
  defaultConsent: "always",
  modifiesState: true,
  mutationTracking: "none",
  requiresBlueprintApproval: false,
  isEnabled: (ctx) => !ctx.testingEnabled,
  getConsentPreview: () => "Enable E2E testing",
  execute: async (_args, ctx) => {
    if (
      userInputRegistry
        .getPending()
        .some(
          ({ descriptor }) =>
            descriptor.chatId === ctx.chatId &&
            descriptor.kind === "enable-testing",
        )
    ) {
      return "Testing has already been offered in this turn. Wait for the user's decision; do not create or run tests while testing is disabled.";
    }
    const requestId = userInputRegistry.request({
      kind: "enable-testing",
      chatId: ctx.chatId,
      appId: ctx.appId,
      classifier: "none",
      followUpPrompt: ENABLE_TESTING_FOLLOW_UP_PROMPT,
    });
    const xml = (outcome: string) =>
      `<dyad-enable-testing request-id="${escapeXmlAttr(requestId)}" outcome="${outcome}"></dyad-enable-testing>`;
    // Persist before parking so reloads and other windows can show this card.
    ctx.onXmlComplete(xml("pending"));
    const result = await userInputRegistry.park(requestId, ctx.abortSignal);
    if (result?.kind !== "enable-testing") {
      ctx.onXmlComplete(xml("dismissed"));
      return "The testing request was cancelled. Do not create or run tests.";
    }
    ctx.onXmlComplete(xml(result.enabled ? "enabled" : "declined"));
    return result.enabled
      ? "The user enabled E2E testing. End this turn now. Dyad will automatically resume the original request in a fresh turn with run_tests and Dyad's test-writing conventions. Do not write tests in this turn."
      : "The user declined to enable E2E testing. End this turn now. Dyad will resume the original task without writing or running tests. Do not offer testing again unless the user explicitly asks to enable it.";
  },
};
