import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the search_replace agent tool
 * Tests targeted file editing with the strict search_replace tool
 */

testSkipIfWindows("local-agent - search_replace edit", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/search-replace");

  // Verify the search_replace output is shown
  await expect(po.page.getByTestId("dyad-search-replace")).toBeVisible();

  await po.snapshotMessages();
  await po.snapshotAppFiles({
    name: "after-search-replace",
    files: ["src/App.tsx"],
  });
});
