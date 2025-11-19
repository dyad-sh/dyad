import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("concurrent chat", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=chat1 [sleep=medium]", {
    skipWaitForCompletion: true,
  });
  // Need a short wait otherwise the click on Apps tab is ignored.
  await po.sleep(2_000);

  await po.goToAppsTab();
  await po.sendPrompt("tc=chat2");
  await po.snapshotMessages();
  await po.clickChatActivityButton();

  // Chat #1 will be the last in the list
  expect(
    await po.page.getByTestId(`chat-activity-list-item-1`).textContent(),
  ).toContain("Chat #1");
  await po.page.getByTestId(`chat-activity-list-item-1`).click();
  await po.snapshotMessages({ timeout: 12_000 });

  //
});
