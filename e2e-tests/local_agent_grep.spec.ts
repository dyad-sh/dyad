import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";
import { testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for the grep agent tool
 * Tests searching file contents with ripgrep in local-agent mode
 */

testSkipIfWindows("local-agent - grep search", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/grep-search");

  await po.page.getByTestId("dyad-grep").first().click();
  await po.page.getByTestId("dyad-grep").nth(1).click();
  await po.snapshotMessages();
  await po.snapshotStableAria(
    po.page.getByTestId("dyad-grep").first(),
    "local-agent---grep-search-2",
  );
  await po.snapshotStableAria(
    po.page.getByTestId("dyad-grep").nth(1),
    "local-agent---grep-search-3",
  );
});

testSkipIfWindows(
  "local-agent - grep searches ignored files when requested",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    const appPath = await po.appManagement.getCurrentAppPath();
    const ignoredPackageDir = path.join(appPath, "node_modules", "ignored-pkg");
    fs.mkdirSync(ignoredPackageDir, { recursive: true });
    fs.writeFileSync(
      path.join(ignoredPackageDir, "index.js"),
      "export const ignoredNeedle = 'search ignored files';\n",
    );

    await po.sendPrompt("tc=local-agent/grep-include-ignored");

    const grepCard = po.page.getByTestId("dyad-grep").first();
    await expect(grepCard).toContainText('"ignoredNeedle"');
    await grepCard.click();
    await expect(grepCard).toContainText("node_modules/ignored-pkg/index.js");
    await expect(grepCard).toContainText("ignoredNeedle");
  },
);
