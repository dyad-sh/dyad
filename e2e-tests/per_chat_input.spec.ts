import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("chat input is preserved when switching between chats", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Chat 1: send a message so it becomes a real chat
  await po.sendPrompt("[dump] first chat setup");
  await po.chatActions.waitForChatCompletion();

  // Type some text in Chat 1's input without sending
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible();
  await chatInput.fill("unsent text in chat one");
  await expect(chatInput).toContainText("unsent text in chat one");

  // Create Chat 2
  await po.chatActions.clickNewChat();
  await expect(chatInput).toBeVisible();
  await po.sendPrompt("[dump] second chat setup");
  await po.chatActions.waitForChatCompletion();

  // Type different text in Chat 2
  await chatInput.fill("unsent text in chat two");
  await expect(chatInput).toContainText("unsent text in chat two");

  // Switch to Chat 1 via the inactive tab
  const inactiveTab = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab.locator("button").first().click();

  // Chat 1 should still have its unsent text
  await expect(chatInput).toContainText("unsent text in chat one", {
    timeout: Timeout.MEDIUM,
  });

  // Switch back to Chat 2 (now the inactive tab)
  const inactiveTab2 = po.page
    .locator("div[draggable]")
    .filter({ hasNot: po.page.locator('button[aria-current="page"]') });
  await inactiveTab2.locator("button").first().click();

  // Chat 2 should still have its unsent text
  await expect(chatInput).toContainText("unsent text in chat two", {
    timeout: Timeout.MEDIUM,
  });
});

test("new chat starts with empty input", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Chat 1: type something
  await po.sendPrompt("[dump] initial message");
  await po.chatActions.waitForChatCompletion();
  const chatInput = po.chatActions.getChatInput();
  await chatInput.fill("some draft text");
  await expect(chatInput).toContainText("some draft text");

  // Create a new chat
  await po.chatActions.clickNewChat();

  // New chat input should be empty
  await expect(chatInput).toBeVisible({ timeout: Timeout.SHORT });
  await expect(async () => {
    const text = await chatInput.textContent();
    expect(text?.trim()).toBe("");
  }).toPass({ timeout: Timeout.SHORT });
});

test("closing a chat tab clears its stored input", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Chat 1
  await po.sendPrompt("[dump] chat one message");
  await po.chatActions.waitForChatCompletion();

  // Chat 2
  await po.chatActions.clickNewChat();
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible();
  await po.sendPrompt("[dump] chat two message");
  await po.chatActions.waitForChatCompletion();

  // Type in Chat 2
  await chatInput.fill("draft in chat two");
  await expect(chatInput).toContainText("draft in chat two");

  // Close the active tab (Chat 2) using the close button on the active tab
  const activeTabContainer = po.page
    .locator("div[draggable]")
    .filter({ has: po.page.locator('button[aria-current="page"]') });
  await activeTabContainer.getByLabel(/^Close tab:/).click();

  // Should now be on Chat 1 — input should not contain Chat 2's text
  await expect(chatInput).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(po.page.getByText("chat one message")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(async () => {
    const text = await chatInput.textContent();
    expect(text?.trim() ?? "").not.toContain("draft in chat two");
  }).toPass({ timeout: Timeout.MEDIUM });
});

test("input preserved when switching back and forth multiple times", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.chatActions.getChatInput();

  // Chat 1
  await po.sendPrompt("[dump] chat alpha");
  await po.chatActions.waitForChatCompletion();
  await expect(chatInput).toBeVisible();
  await chatInput.fill("draft-alpha");
  await expect(chatInput).toContainText("draft-alpha");

  // Chat 2
  await po.chatActions.clickNewChat();
  await expect(chatInput).toBeVisible();
  await po.sendPrompt("[dump] chat beta");
  await po.chatActions.waitForChatCompletion();
  await chatInput.fill("draft-beta");
  await expect(chatInput).toContainText("draft-beta");

  // We're on Chat 2. Switch to Chat 1 (inactive tab).
  const getInactiveTab = () =>
    po.page
      .locator("div[draggable]")
      .filter({ hasNot: po.page.locator('button[aria-current="page"]') });

  await getInactiveTab().locator("button").first().click();
  await expect(chatInput).toContainText("draft-alpha", {
    timeout: Timeout.MEDIUM,
  });

  // Switch back to Chat 2
  await getInactiveTab().locator("button").first().click();
  await expect(chatInput).toContainText("draft-beta", {
    timeout: Timeout.MEDIUM,
  });

  // Switch to Chat 1 again — still preserved after multiple switches
  await getInactiveTab().locator("button").first().click();
  await expect(chatInput).toContainText("draft-alpha", {
    timeout: Timeout.MEDIUM,
  });
});
