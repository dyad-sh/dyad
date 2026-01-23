import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

/**
 * E2E test for summarization in local-agent mode
 * Tests that summarize to new chat works correctly when using Agent v2
 * Regression test for #2292
 *
 * This test directly triggers summarization by sending the "Summarize from chat-id=X"
 * prompt, which is the same mechanism used by the "Summarize into new chat" button.
 */
testSkipIfWindows(
  "local-agent - summarize to new chat works",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.selectLocalAgentMode();

    // First, send a message to create a chat with some content
    // This simulates a chat with technical discussion
    await po.sendPrompt("tc=local-agent/read-then-edit");

    // Get the current chat URL to extract the chat ID
    const url = po.page.url();
    const chatIdMatch = url.match(/[?&]id=(\d+)/);
    expect(chatIdMatch).toBeTruthy();
    const originalChatId = chatIdMatch![1];

    // Create a new chat by clicking the "New Chat" button
    await po.clickNewChat();

    // Now trigger summarization by sending the summarize prompt
    // This is the same mechanism used by the "Summarize into new chat" button
    await po.sendPrompt(`Summarize from chat-id=${originalChatId}`);

    // Snapshot the messages in the new chat
    // This verifies that the summarization actually ran and produced content
    // (Before the fix, this would fail with "no technical discussion" error
    // because the local agent handler wasn't receiving the formatted chat content)
    await po.snapshotMessages();
  },
);
