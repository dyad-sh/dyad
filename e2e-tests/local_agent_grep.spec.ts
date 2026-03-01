import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the grep agent tool
 * Tests searching file contents with ripgrep in local-agent mode
 */

testSkipIfWindows("local-agent - grep search", async ({ po }) => {
  await po.setUpConeyPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/grep-search");

  await po.page.getByTestId("coney-grep").first().click();
  await po.page.getByTestId("coney-grep").nth(1).click();
  await po.snapshotMessages();
  await expect(po.page.getByTestId("coney-grep").first()).toMatchAriaSnapshot();
  await expect(po.page.getByTestId("coney-grep").nth(1)).toMatchAriaSnapshot();
});
