// @vitest-environment node
// Opt-in live validation: DYAD_LIVE_PRESERVED_THINKING=1 DYAD_PRO_KEY=...
// npm run eval -- src/__tests__/evals/preserved_thinking.eval.ts
import { getModelPreferenceKey } from "@/lib/modelEffort";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});
vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});
import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";

// This drives real chat:stream requests, including mode-specific prompts/tools
// and persisted AI SDK history. No production user data is loaded.
describe.skipIf(process.env.DYAD_LIVE_PRESERVED_THINKING !== "1")(
  "live preserved thinking",
  () => {
    let harness: ChatFlowHarness;
    const requests: Array<{ thinkingPaths: string[]; dropBlock: boolean }> = [];
    let restoreFetch: (() => void) | undefined;
    beforeAll(async () => {
      expect(process.env.DYAD_PRO_KEY).toBeTruthy();
      const originalFetch = globalThis.fetch;
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementation(async (input, init) => {
          if (
            String(input).endsWith("/messages") &&
            typeof init?.body === "string"
          ) {
            const body = JSON.parse(init.body);
            const thinkingPaths: string[] = [];
            for (const [i, message] of body.messages.entries()) {
              if (!Array.isArray(message.content)) continue;
              for (const [j, part] of message.content.entries()) {
                if (part.type === "thinking" && part.signature)
                  thinkingPaths.push(`messages.${i}.content.${j}`);
              }
            }
            requests.push({
              thinkingPaths,
              dropBlock:
                body.thinking?.block_binding?.prefix_mismatch_behavior ===
                "drop_block",
            });
            console.log(
              "PRESERVED_THINKING_INPUT",
              JSON.stringify(requests.at(-1)),
            );
          }
          return originalFetch(input, init);
        });
      restoreFetch = () => fetchSpy.mockRestore();
      harness = await setupChatFlowHarness({
        electronMock: h,
        chatMode: "plan",
        engine: false,
        useFakeCatalog: false,
        selectedModel: {
          provider: "anthropic",
          name: "claude-opus-5-5",
        },
        settings: {
          enableDyadPro: true,
          modelEffortPreferences: {
            [getModelPreferenceKey({
              provider: "anthropic",
              name: "claude-opus-5-5",
            })]: "high",
          },
          selectedModel: {
            provider: "anthropic",
            name: "claude-opus-5-5",
          },
          enableCodeExplorer: false,
          enableImplementerSubagent: false,
          providerSettings: {
            auto: { apiKey: { value: process.env.DYAD_PRO_KEY! } },
          },
        },
      });
    }, 60_000);
    afterAll(async () => {
      await harness?.dispose();
      restoreFetch?.();
    });
    it("logs transformations across Plan → Agent → Agent", async () => {
      const turns = [
        [
          "plan",
          "Without reading files or using tools, reason about a segmented prime sieve and propose a short implementation plan. Do not create a plan file; this is a conceptual question.",
        ],
        [
          "local-agent",
          "Without using tools or modifying files, implement that segmented sieve as a short Python code example in your reply. Carefully verify inclusive bounds and the p-squared starting multiple.",
        ],
        [
          "local-agent",
          "Without using tools, verify your previous code for ranges [0,1], [1,2], [25,49], and [47,121]. Derive its loop invariant and explain any corrections briefly.",
        ],
      ] as const;
      for (const [turnIndex, [requestedChatMode, prompt]] of turns.entries()) {
        const firstRequest = requests.length;
        console.log("PRESERVED_THINKING_TURN", requestedChatMode);
        const result = await harness.streamChat(prompt, { requestedChatMode });
        expect(result.result).not.toBe("error");
        expect(result.eventsFor("chat:error")).toHaveLength(0);
        const assistant = result.messages
          .filter((m) => m.role === "assistant")
          .at(-1);
        expect(assistant?.aiMessagesJson).toBeTruthy();
        const reasoning = assistant!.aiMessagesJson!.messages.reduce(
          (count, message) =>
            count +
            (Array.isArray(message.content)
              ? message.content.filter((part) => part.type === "reasoning")
                  .length
              : 0),
          0,
        );
        console.log(
          "PRESERVED_THINKING_OUTPUT",
          JSON.stringify({ mode: requestedChatMode, reasoning }),
        );
        expect(reasoning).toBeGreaterThan(0);
        expect(requests[firstRequest]?.dropBlock).toBe(true);
        expect(
          requests[firstRequest]?.thinkingPaths.length,
        ).toBeGreaterThanOrEqual(turnIndex);
      }
    }, 600_000);
  },
);
