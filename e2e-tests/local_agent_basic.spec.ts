import fs from "node:fs";
import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent mode (Agent v2)
 * Tests multi-turn tool call conversations using the TypeScript DSL fixtures
 */

testSkipIfWindows(
  "local-agent - app blueprint name conflict auto-suffixes the name",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });

    // Seed a name collision: rename the first imported app to the exact name
    // the blueprint fixture will try to claim ("Lumen Notes").
    await po.importApp("minimal");
    await po.appManagement.getTitleBarAppNameButton().click();
    await po.appManagement.clickAppDetailsRenameAppButton();
    await po.page
      .getByRole("textbox", { name: "Enter new app name" })
      .fill("Lumen Notes");
    await po.page.getByRole("button", { name: "Continue" }).click();
    await po.page
      .getByRole("button", { name: "Recommended Rename app and" })
      .click();
    await expect(async () => {
      expect(await po.appManagement.getCurrentAppName()).toBe("Lumen Notes");
    }).toPass({ timeout: Timeout.MEDIUM });

    // Second app runs the blueprint flow; approving it tries to take the same
    // name. Instead of blocking with a dialog, approval auto-resolves the
    // conflict by appending a numeric suffix to the name and folder. Navigate
    // back to the home page first so the "Import App" button is available
    // (it lives on the new-app screen).
    await po.navigation.goToAppsTab();
    await po.page.getByRole("button", { name: "New App" }).click();
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();
    await po.appManagement.enableAppBlueprintForCurrentApp();
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/app-blueprint-rename");

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await approveButton.click();

    await expect(async () => {
      expect(await po.appManagement.getCurrentAppName()).toBe("Lumen Notes 2");
      const appPath = await po.appManagement.getCurrentAppPath();
      expect(appPath.endsWith("lumen-notes-2"), `appPath=${appPath}`).toBe(
        true,
      );
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);
testSkipIfWindows(
  "local-agent - app blueprint approval sanitizes invalid folder characters",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();
    await po.appManagement.enableAppBlueprintForCurrentApp();
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/app-blueprint-invalid-name");

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await approveButton.click();

    // The display name keeps its expressive characters; the folder is a
    // filesystem-safe lowercase slug with accents transliterated.
    await expect(async () => {
      expect(await po.appManagement.getCurrentAppName()).toBe(
        "Food/Drink Planner: Café Edition",
      );
      const appPath = await po.appManagement.getCurrentAppPath();
      expect(appPath.endsWith("food-drink-planner-cafe-edition")).toBe(true);
      expect(fs.existsSync(appPath)).toBe(true);
    }).toPass({ timeout: Timeout.LONG });
  },
);
