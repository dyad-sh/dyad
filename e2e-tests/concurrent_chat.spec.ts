import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("concurrent chat", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("tc=chat1 [sleep=long]", {
    skipWaitForCompletion: true,
  });
  await expect
    .poll(() => new URL(po.page.url()).searchParams.get("id"))
    .not.toBeNull();
  const chat1Id = new URL(po.page.url()).searchParams.get("id");
  expect(chat1Id).not.toBeNull();

  await po.chatActions.clickNewChat();
  await po.sendPrompt("tc=chat2");
  await po.snapshotMessages();

  // The background turn may complete before the foreground chat settles, but
  // both chat tabs must remain independently selectable.
  const chat1Tab = po.page
    .getByTestId(`chat-tab-${chat1Id}`)
    .locator("button")
    .first();
  await expect(chat1Tab).toBeVisible();
  await chat1Tab.click();
  await po.snapshotMessages({ timeout: 12_000 });
});
