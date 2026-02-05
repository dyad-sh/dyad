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
    await po.selectLocalAgentMode();

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
    // Snapshot the messages to capture the compaction summary + second response
    await po.snapshotMessages({ replaceDumpPath: true });
  },
);
