import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the code_search agent tool
 * Tests semantic code search in local-agent mode
 */

testSkipIfWindows("local-agent - code search", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enableCodeExplorer: false,
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().enableCodeExplorer)
    .toBe(false);

  await po.sendPrompt("tc=local-agent/code-search");

  await po.snapshotMessages();
});
