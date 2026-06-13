import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("local-agent - explore_code experiment", async ({ po }) => {
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

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request", { name: "disabled" });

  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enableCodeExplorer: true,
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().enableCodeExplorer)
    .toBe(true);

  await po.appManagement.ensurePnpmInstall();
  await po.chatActions.clickNewChat();
  await po.chatActions.selectLocalAgentMode();
  await po.sendPrompt("tc=local-agent/explore-code");

  const card = po.page.getByTestId("dyad-explore-code");
  await expect(card).toBeVisible({ timeout: Timeout.LONG });
  await card.click();
  await expect(card).toContainText("explore_code report");
  await expect(card).toContainText("src/App.tsx");
  await expect(card).toContainText("compiler-backed symbol window");
  await expect(card).toContainText("Read targets");

  await po.snapshotMessages();
});
