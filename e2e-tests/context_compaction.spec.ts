import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

/**
 * E2E tests for context compaction feature.
 * Tests that long conversations are automatically compacted when token usage
 * exceeds the threshold, and that the compaction summary is displayed.
 */

testSkipIfWindows(
  "local-agent - context compaction triggers and shows summary",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Send first message with a fixture that returns 200k token usage.
    // This exceeds the compaction threshold (min(80% of context window, 180k))
    // and marks the chat for compaction on the next message.
    await po.sendPrompt("tc=local-agent/compaction-trigger");

    // Send a second message. The local agent handler detects pending compaction,
    // performs it (generates a summary, replaces old messages), then processes
    // the second message normally.
    await po.sendPrompt("tc=local-agent/simple-response");

    // Verify the compaction status indicator is visible
    await expect(po.page.getByText("Conversation compacted")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await po.sendPrompt("[dump] hi");
    await po.snapshotServerDump("all-messages");

    // Verify key compaction elements are present (order-independent checks
    // since compaction restructures messages non-deterministically)
    await expect(
      po.page.getByRole("button", { name: "Conversation compacted" }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("heading", { name: "Key Decisions Made" }),
    ).toBeVisible();
    await expect(
      po.page.getByText(
        "Hello! I understand your request. This is a simple response from the Basic Agent mode.",
      ),
    ).toBeVisible();
  },
);

testSkipIfWindows(
  "local-agent - context compaction can run mid-turn",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("hi");

    // This fixture emits a tool call with high token usage in step 1, then
    // returns a final text response in step 2 of the same user turn.
    await po.sendPrompt("tc=local-agent/compaction-mid-turn");

    // Mid-turn compaction summary should be visible after a single prompt.
    await expect(po.page.getByText("Conversation compacted")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // The agent should still complete the response in the same turn.
    await expect(po.page.getByText("END OF COMPACTED TURN.")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await po.sendPrompt("[dump] hi");
    await po.snapshotServerDump("all-messages");

    // Verify key compaction elements are present (order-independent checks
    // since compaction restructures messages non-deterministically)
    await expect(
      po.page.getByRole("button", { name: "Conversation compacted" }),
    ).toBeVisible();
    await expect(
      po.page.getByRole("heading", { name: "Key Decisions Made" }),
    ).toBeVisible();
    await expect(po.page.getByText("END OF COMPACTED TURN.")).toBeVisible();
  },
);
