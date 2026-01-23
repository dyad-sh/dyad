import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("default chat mode - pro user defaults and setting change applies to new chat", async ({
  po,
}) => {
  await po.setUpDyadPro({ localAgent: true, autoApprove: true });

  // Pro users should default to local-agent mode
  await expect(
    po.getHomeChatInputContainer().getByTestId("chat-mode-selector"),
  ).toHaveText("Agent");

  // Change default chat mode to "agent" (Build with MCP) in settings
  await po.goToSettingsTab();
  const beforeSettings = po.recordSettings();
  await po.page.getByLabel("Default Chat Mode").click();
  await po.page.getByRole("option", { name: "Build with MCP" }).click();
  po.snapshotSettingsDelta(beforeSettings);

  // Import an app and create a new chat to verify the default is applied
  await po.goToAppsTab();
  await po.importApp("minimal");
  await po.clickNewChat();

  // Verify the chat mode selector shows the new default mode
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Build (MCP)",
  );
});

test("default chat mode - non-pro user defaults to build", async ({ po }) => {
  await po.setUp();

  // Non-pro users should default to build mode
  await expect(
    po.getHomeChatInputContainer().getByTestId("chat-mode-selector"),
  ).toHaveText("Build");
});
