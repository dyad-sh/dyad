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
  await po.appManagement.ensureCodeExplorerReady();
  await po.chatActions.clickNewChat();
  await po.chatActions.selectLocalAgentMode();
  await po.sendPrompt("tc=local-agent/explore-code");

  // .first(): while the run streams, the live-preview overlay card and the
  // committed card can briefly coexist during the overlay→commit handoff.
  const card = po.page.getByTestId("subagent-card").first();
  await expect(card).toBeVisible({ timeout: Timeout.LONG });
  await expect(card).toContainText("App component render flow");
  await expect(
    po.page.getByTestId("subagent-card-subtitle").first(),
  ).toContainText("confidence");

  // Clicking the card opens the Agents panel deep-linked to this run.
  await card.click();
  const detail = po.page.getByTestId("agents-panel-detail");
  await expect(detail).toBeVisible();
  await expect(detail).toContainText("App component render flow");
  // Step timeline records the forced explore_code first step.
  await expect(detail).toContainText("explore_code");
  // Structured output renders the flow with jump-to-code file links.
  await expect(detail).toContainText("src/App.tsx");
  await expect(detail).toContainText("confidence");
  await expect(detail).toContainText("Read targets");

  await po.snapshotMessages();
});
