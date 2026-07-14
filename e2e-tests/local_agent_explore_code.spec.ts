import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows(
  "local-agent - sub-agent tool replacement",
  async ({ po }) => {
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
  },
);
