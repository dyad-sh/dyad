import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent in ask mode (read-only mode for Pro users)
 * Tests that Pro users in ask mode get access to read-only tools
 */

testSkipIfWindows("local-agent ask mode", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enableCodeExplorer: false,
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().enableCodeExplorer)
    .toBe(false);
  await po.importApp("minimal");

  // Select ask mode - local agent will be used in read-only mode for Pro users
  await po.chatActions.selectChatMode("ask");

  // Test read-only tools work
  await po.sendPrompt("tc=local-agent/ask-read-file");
  await po.snapshotMessages();

  // Dump a fresh request to verify only read-only tools are provided. Keep the
  // sandbox tool result out of this dump because it includes execution timing.
  await po.chatActions.clickNewChat();
  await po.chatActions.selectChatMode("ask");
  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request");
});
