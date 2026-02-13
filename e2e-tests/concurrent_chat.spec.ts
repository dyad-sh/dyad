import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("concurrent chat", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=chat1 [sleep=medium]", {
    skipWaitForCompletion: true,
  });
  // Need a short wait otherwise the click on Apps tab is ignored.
  await po.sleep(2_000);

  await po.navigation.goToAppsTab();
  await po.sendPrompt("tc=chat2");
  await po.snapshotMessages();

  // Chat #1 tab should be visible in the chat tabs with an "in progress" indicator
  // Find the tab that contains the "Chat in progress" indicator and click it
  const chat1TabContainer = po.page
    .locator('[aria-label="Chat in progress"]')
    .locator(
      "xpath=ancestor::div[contains(@class, 'flex') and contains(@class, 'h-10')]",
    );
  await expect(chat1TabContainer).toBeVisible();

  // Click the button inside the tab to select it
  await chat1TabContainer.locator("button").first().click();
  await po.snapshotMessages({ timeout: 12_000 });
});
