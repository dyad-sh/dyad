import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows(
  "clicking send to chat button adds log to chat input",
  async ({ po }) => {
    await po.setUp();

    // Create an app with console output using fixture
    await po.sendPrompt("tc=write-index");
    await po.approveProposal();

    // Wait for app to run
    const picker = po.page.getByTestId("preview-pick-element-button");
    await expect(picker).toBeEnabled({ timeout: Timeout.EXTRA_LONG });

    // Open the system messages console
    const consoleHeader = po.page.locator('text="System Messages"').first();
    await consoleHeader.click();

    // Wait for the log entry to appear
    const logEntry = await po.page.getByTestId("log-entry").last();
    expect(logEntry).toBeVisible({ timeout: Timeout.EXTRA_LONG });

    // Hover over the log entry to reveal the send to chat button
    await logEntry.hover();

    // Click the send to chat button (MessageSquare icon)
    const sendToChatButton = logEntry.getByTestId("send-to-chat");
    await sendToChatButton.click({ timeout: Timeout.EXTRA_LONG });

    // Check that the chat input now contains the log information
    const chatInput = po.getChatInput();
    const inputValue = await chatInput.textContent();

    // Verify the log was added to chat input
    expect(inputValue).toContain("```");
  },
);

testSkipIfWindows("clear filters button works", async ({ po }) => {
  await po.setUp();

  // Create a basic app using fixture
  await po.sendPrompt("tc=write-index");
  await po.approveProposal();

  // Wait for app to run
  await po.page
    .getByTestId("preview-pick-element-button")
    .click({ timeout: Timeout.EXTRA_LONG });

  // Open the system messages console
  const consoleHeader = po.page.locator('text="System Messages"').first();
  await consoleHeader.click();

  // Apply a filter
  const levelFilter = po.page
    .locator("select")
    .filter({ hasText: "All Levels" });
  await levelFilter.selectOption("error");

  // Check that clear button appears
  const clearButton = po.page.getByRole("button", { name: "Clear" });
  await expect(clearButton).toBeVisible();

  // Click clear button
  await clearButton.click();

  // Verify filters are reset
  const filterValue = await levelFilter.inputValue();
  expect(filterValue).toBe("all");
});
