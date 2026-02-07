import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for list_files tool
 */

testSkipIfWindows("local-agent - list_files", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/list-files-non-recursive");
  await po.sendPrompt("tc=local-agent/list-files-recursive");
  const listFiles1 = po.page.getByTestId("dyad-list-files").first();
  await listFiles1.click();
  await expect(listFiles1).toMatchAriaSnapshot();

  const listFiles2 = po.page.getByTestId("dyad-list-files").nth(1);
  await listFiles2.click();
  await expect(listFiles2).toMatchAriaSnapshot();
});

testSkipIfWindows("local-agent - list_files include_hidden", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal-with-dyad");
  await po.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/list-files-include-hidden");
  const listFiles = po.page.getByTestId("dyad-list-files").first();
  await listFiles.click();
  await expect(listFiles).toMatchAriaSnapshot();
});
