import { expect, it } from "vitest";
import { portableSubscriptionHistory } from "./subscription_history";
it("removes account-bound persisted reasoning but preserves paired tools and visible context", () => {
  const history = portableSubscriptionHistory([
    {
      role: "assistant",
      content: [
        {
          type: "reasoning",
          text: "thinking",
          providerOptions: { openai: { reasoningEncryptedContent: "opaque" } },
        },
        {
          type: "tool-call",
          toolCallId: "call1",
          toolName: "read_file",
          input: { path: "a" },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "call1",
          toolName: "read_file",
          output: { type: "text", value: "contents" },
        },
      ],
    },
  ]);
  expect(history).toHaveLength(2);
  expect(JSON.stringify(history)).not.toContain("opaque");
  expect(JSON.stringify(history)).toContain("contents");
  expect(JSON.stringify(history).match(/call1/g)).toHaveLength(2);
});
