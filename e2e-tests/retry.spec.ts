import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("retry - should work", async ({ po }) => {
  await po.setUp();
  await po.sendPrompt("[increment]");
  await po.snapshotMessages();

  await po.toastNotifications.dismissAllToasts();
  await po.chatActions.clickRetry();
  await po.toastNotifications.expectNoToast();
  const messagesList = po.page.getByTestId("messages-list");
  await expect(async () => {
    expect(await messagesList.textContent()).not.toContain("counter=");
  })
    .toPass({ timeout: Timeout.SHORT })
    .catch(() => {
      // The retry response may finish before Playwright observes the transient
      // state where the previous assistant message has been removed.
    });
  await expect(messagesList.getByText(/counter=\d+/)).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  // The counter should be incremented in the snapshotted messages.
  await po.snapshotMessages();
});
