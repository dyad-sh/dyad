import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent mode (Agent v2)
 * Tests multi-turn tool call conversations using the TypeScript DSL fixtures
 */

testSkipIfWindows(
  "local-agent - app blueprint name conflict opens rename dialog",
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
    // name, which must now conflict. Navigate back to the home page first so
    // the "Import App" button is available (it lives on the new-app screen).
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

    // Instead of a toast + silent failure, the conflict surfaces a dialog
    // pre-filled with the rejected name. Pick a free name and re-approve.
    await expect(po.page.getByText("App name already in use")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    const conflictInput = po.page.getByRole("textbox", {
      name: "App name",
    });
    await expect(conflictInput).toHaveValue("Lumen Notes");
    await conflictInput.fill("Aurora Notes");
    await po.page.getByRole("button", { name: "Use name & approve" }).click();

    await expect(async () => {
      expect(await po.appManagement.getCurrentAppName()).toBe("Aurora Notes");
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);
