import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("default chat mode - settings dropdown change applies to new chat", async ({
  po,
}) => {
  await po.setUpDyadPro({ localAgent: true, autoApprove: true });

  await po.navigation.goToSettingsTab();
  const beforeSettings = po.settings.recordSettings();
  await po.page.getByLabel("Default Chat Mode").click();
  await po.page.getByRole("option", { name: /^Build/ }).click();
  po.settings.snapshotSettingsDelta(beforeSettings);

  // Import an app and create a new chat to verify the default is applied
  await po.navigation.goToAppsTab();
  await po.importApp("minimal");
  await po.chatActions.clickNewChat();

  // Verify the chat mode selector shows the new default mode
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Build",
  );
});
