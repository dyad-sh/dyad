import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";
test("user can search for chats in an app", async ({ po }) => {
  // Go to the chat tab (or wherever your chat sidebar is)
  await po.goToChatTab();

  // Optionally, create a new chat with a known title for testing
  await po.clickNewChat();
  // Add a delay or wait for the chat to appear if needed

  // Fill the search input (use getByPlaceholder or getByTestId for reliability)
  const searchInput = po.page.getByPlaceholder("Search chats...");
  await searchInput.fill("New Chat");

  // Wait for the search results to update
  await po.page.waitForTimeout(500); // or use a more robust wait

  // Assert that the chat list contains the expected result
  const chatListItems = await po.page
    .locator(".chat-list-item")
    .allTextContents();
  expect(
    chatListItems.some((r) => r.toLowerCase().includes("new chat")),
  ).toBeTruthy();
});
