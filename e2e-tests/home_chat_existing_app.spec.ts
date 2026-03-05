import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("home chat - start new chat in existing app", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create an app first
  await po.sendPrompt("create a todo application");

  // Go back to home page
  await po.navigation.goToAppsTab();
  await expect(po.chatActions.getHomeChatInputContainer()).toBeVisible();

  // Click the app selector button in the home chat input
  const appSelector = po.page.getByTestId("home-app-selector");
  await appSelector.click();

  // Wait for the search dialog and select the first app
  await po.page.getByTestId("app-search-dialog").waitFor({ state: "visible" });
  const firstApp = po.page.getByTestId(/^app-search-item-/).first();
  await expect(firstApp).toBeVisible();
  const appName = await firstApp.textContent();
  await firstApp.click();

  // Dialog should close after selection
  await po.page
    .getByTestId("app-search-dialog")
    .waitFor({ state: "hidden", timeout: 5000 });

  // The app selector should now show the selected app name
  await expect(appSelector).toContainText(appName!.trim());

  // The clear button should be visible
  await expect(po.page.getByTestId("home-app-selector-clear")).toBeVisible();

  // Type a message and send it to the existing app
  const chatInput = po.page.locator('[data-lexical-editor="true"]');
  await chatInput.click();
  await chatInput.fill("add a new feature");
  await po.page.getByRole("button", { name: "Send message" }).click();

  // Should navigate to the app's chat page
  await po.chatActions.waitForChatCompletion();

  // Verify we're in the app's chat — the title bar should show the app name
  const currentAppName = await po.appManagement.getCurrentAppName();
  expect(currentAppName).toBeTruthy();
});

test("home chat - clear selected app", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Create an app first
  await po.sendPrompt("create a todo application");

  // Go back to home page
  await po.navigation.goToAppsTab();
  await expect(po.chatActions.getHomeChatInputContainer()).toBeVisible();

  // Select an app via the app selector
  const appSelector = po.page.getByTestId("home-app-selector");
  await appSelector.click();

  await po.page.getByTestId("app-search-dialog").waitFor({ state: "visible" });
  await po.page
    .getByTestId(/^app-search-item-/)
    .first()
    .click();
  await po.page
    .getByTestId("app-search-dialog")
    .waitFor({ state: "hidden", timeout: 5000 });

  // The app selector should show the selected app
  await expect(appSelector).not.toContainText("No app selected");

  // Click the clear button to deselect the app
  await po.page.getByTestId("home-app-selector-clear").click();

  // The app selector should now show "No app selected"
  await expect(appSelector).toContainText("No app selected");

  // The clear button should no longer be visible
  await expect(po.page.getByTestId("home-app-selector-clear")).toBeHidden();
});
