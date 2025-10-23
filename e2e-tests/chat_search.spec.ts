import { test } from "./helpers/test_helper";

test.skip("chat search - basic search dialog functionality", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create some chats with specific names for testing
  await po.sendPrompt("[dump] create a todo application");
  await po.waitForChatCompletion();

  await po.clickNewChat();
  await po.sendPrompt("[dump] build a weather dashboard");
  await po.waitForChatCompletion();

  await po.clickNewChat();
  await po.sendPrompt("[dump] create a blog system");
  await po.waitForChatCompletion();

  // Test 1: Open search dialog using the search button
  await po.page.getByTestId("search-chats-button").click();

  // Wait for search dialog to appear
  await po.page.getByTestId("chat-search-dialog").waitFor();

  // Test 2: Close dialog with escape key
  await po.page.keyboard.press("Escape");
  await po.page.getByTestId("chat-search-dialog").waitFor({ state: "hidden" });

  // Test 3: Open dialog again and verify it shows chats
  await po.page.getByTestId("search-chats-button").click();
  await po.page.getByTestId("chat-search-dialog").waitFor();

  // Test 4: Search for specific term
  await po.page.getByPlaceholder("Search chats").fill("todo");

  // Wait a moment for search results
  await po.page.waitForTimeout(500);

  // Test 5: Clear search and close
  await po.page.getByPlaceholder("Search chats").clear();
  await po.page.keyboard.press("Escape");
});

test.skip("chat search - with named chats for easier testing", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create chats with descriptive names that will be useful for testing
  await po.sendPrompt("[dump] hello world app");
  await po.waitForChatCompletion();

  // Use a timeout to ensure the UI has updated before trying to interact
  await po.page.waitForTimeout(1000);

  await po.clickNewChat();
  await po.sendPrompt("[dump] todo list manager");
  await po.waitForChatCompletion();

  await po.page.waitForTimeout(1000);

  await po.clickNewChat();
  await po.sendPrompt("[dump] weather forecast widget");
  await po.waitForChatCompletion();

  await po.page.waitForTimeout(1000);

  // Test search functionality
  await po.page.getByTestId("search-chats-button").click();
  await po.page.getByTestId("chat-search-dialog").waitFor();

  // Search for "todo" - should find the todo list manager chat
  await po.page.getByPlaceholder("Search chats").fill("todo");
  await po.page.waitForTimeout(500);

  // Search for "weather" - should find the weather forecast widget chat
  await po.page.getByPlaceholder("Search chats").fill("weather");
  await po.page.waitForTimeout(500);

  // Search for non-existent term
  await po.page.getByPlaceholder("Search chats").fill("nonexistent");
  await po.page.waitForTimeout(500);

  await po.page.keyboard.press("Escape");
});

test.skip("chat search - keyboard shortcut functionality", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create a chat
  await po.sendPrompt("[dump] sample app");
  await po.waitForChatCompletion();

  // Test keyboard shortcut (Ctrl+K)
  await po.page.keyboard.press("Control+k");
  await po.page.getByTestId("chat-search-dialog").waitFor();

  // Close with escape
  await po.page.keyboard.press("Escape");
  await po.page.getByTestId("chat-search-dialog").waitFor({ state: "hidden" });
});

test.skip("chat search - navigation and selection", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Create multiple chats
  await po.sendPrompt("[dump] first application");
  await po.waitForChatCompletion();

  await po.clickNewChat();
  await po.sendPrompt("[dump] second application");
  await po.waitForChatCompletion();

  // Test selecting a chat through search
  await po.page.getByTestId("search-chats-button").click();
  await po.page.getByTestId("chat-search-dialog").waitFor();

  // Select the first chat item (assuming it shows "Untitled Chat" as default title)
  await po.page.getByText("Untitled Chat").first().click();

  // Dialog should close
  await po.page.getByTestId("chat-search-dialog").waitFor({ state: "hidden" });
});
