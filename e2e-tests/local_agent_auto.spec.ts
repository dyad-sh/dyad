import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows("local-agent - auto model", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true, localAgentUseAutoModel: true });
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      enableCodeExplorer: false,
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().enableCodeExplorer)
    .toBe(false);

  await po.importApp("minimal");

  await po.sendPrompt("[dump]");
  await po.snapshotServerDump("request");
});
