import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows(
  "console logs should appear in the console",
  async ({ po }) => {
    await po.setUp();

    await po.sendPrompt("tc=console-logs");
    await po.approveProposal();

    // Wait for app to run
    const picker = po.page.getByTestId("preview-pick-element-button");
    await expect(picker).toBeEnabled({ timeout: Timeout.EXTRA_LONG });

    // Wait for iframe to load and app to render
    const iframe = po.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Console Logs Test App"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Open the system messages console
    // Logs are generated in useEffect when component mounts, so they may already exist
    const consoleHeader = po.page.locator('text="System Messages"').first();
    await consoleHeader.click();

    // Wait for console to be visible and auto-scroll to complete
    // Wait for at least one log entry to appear, then wait for the last one to be visible
    // This ensures auto-scroll has completed
    await expect(po.page.getByTestId("console-entry").first()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Wait for the last log entry to be visible (ensures auto-scroll to bottom)
    await expect(async () => {
      const allLogs = po.page.getByTestId("console-entry");
      const count = await allLogs.count();
      expect(count).toBeGreaterThan(0);
      await expect(allLogs.last()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Wait for all console logs to appear - use retry logic
    // Verify console.log appears
    await expect(async () => {
      const consoleEntry = po.page
        .getByTestId("console-entry")
        .filter({ hasText: "[LOG] Hello from console.log" });
      const count = await consoleEntry.count();
      expect(count).toBeGreaterThan(0);
      await expect(consoleEntry.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Verify console.info appears
    await expect(async () => {
      const infoEntry = po.page
        .getByTestId("console-entry")
        .filter({ hasText: "[INFO] Info message" });
      const count = await infoEntry.count();
      expect(count).toBeGreaterThan(0);
      await expect(infoEntry.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Verify console.warn appears
    await expect(async () => {
      const warnEntry = po.page
        .getByTestId("console-entry")
        .filter({ hasText: "[WARN] Warning message" });
      const count = await warnEntry.count();
      expect(count).toBeGreaterThan(0);
      await expect(warnEntry.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Verify console.error appears
    await expect(async () => {
      const errorEntry = po.page
        .getByTestId("console-entry")
        .filter({ hasText: "[ERROR] Test error message" });
      const count = await errorEntry.count();
      expect(count).toBeGreaterThan(0);
      await expect(errorEntry.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);

testSkipIfWindows(
  "network requests and responses should appear in the console",
  async ({ po }) => {
    await po.setUp();

    await po.sendPrompt("tc=network-requests");
    await po.approveProposal();

    // Wait for app to run
    const picker = po.page.getByTestId("preview-pick-element-button");
    await expect(picker).toBeEnabled({ timeout: Timeout.EXTRA_LONG });

    // Wait for iframe to load - wait for content to appear
    const iframe = po.getPreviewIframeElement();
    const iframeFrame = iframe.contentFrame();
    await expect(
      iframeFrame.getByText("Network Requests Test App"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    // Wait for service worker to be ready
    // Service worker registration is async, so we wait for it to be active
    // We check by waiting for network request logs to appear, which indicates SW is ready
    // If SW isn't ready, network requests will still work but won't be logged

    // Open the system messages console
    // Network requests happen in useEffect, so they may already be in progress or complete
    const consoleHeader = po.page.locator('text="System Messages"').first();
    await consoleHeader.click();

    // Wait for console to be visible and auto-scroll to complete
    // Wait for at least one log entry to appear, then wait for the last one to be visible
    // This ensures auto-scroll has completed
    await expect(po.page.getByTestId("console-entry").first()).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Wait for the last log entry to be visible (ensures auto-scroll to bottom)
    await expect(async () => {
      const allLogs = po.page.getByTestId("console-entry");
      const count = await allLogs.count();
      expect(count).toBeGreaterThan(0);
      await expect(allLogs.last()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Wait for network requests to appear - use retry logic with proper conditions
    // Network requests happen in useEffect, so they may take a moment

    // Wait for the GET request log to appear
    // Format: "→ GET https://jsonplaceholder.typicode.com/posts/1"
    await expect(async () => {
      const getRequestLocator = po.page
        .getByTestId("console-entry")
        .filter({ hasText: /→ GET.*jsonplaceholder\.typicode\.com\/posts\/1/ });
      const count = await getRequestLocator.count();
      expect(count).toBeGreaterThan(0);
      await expect(getRequestLocator.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Wait for the GET response log to appear
    // Format: "[200] GET https://jsonplaceholder.typicode.com/posts/1 (durationms)"
    await expect(async () => {
      const getResponseLocator = po.page.getByTestId("console-entry").filter({
        hasText: /\[200\].*GET.*jsonplaceholder\.typicode\.com\/posts\/1/,
      });
      const count = await getResponseLocator.count();
      expect(count).toBeGreaterThan(0);
      await expect(getResponseLocator.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Wait for the POST request log to appear
    // Format: "→ POST https://jsonplaceholder.typicode.com/posts"
    await expect(async () => {
      const postRequestLocator = po.page
        .getByTestId("console-entry")
        .filter({ hasText: /→ POST.*jsonplaceholder\.typicode\.com\/posts/ });
      const count = await postRequestLocator.count();
      expect(count).toBeGreaterThan(0);
      await expect(postRequestLocator.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });

    // Wait for the POST response log to appear
    // Format: "[201] POST https://jsonplaceholder.typicode.com/posts (durationms)"
    await expect(async () => {
      const postResponseLocator = po.page.getByTestId("console-entry").filter({
        hasText: /\[201\].*POST.*jsonplaceholder\.typicode\.com\/posts/,
      });
      const count = await postResponseLocator.count();
      expect(count).toBeGreaterThan(0);
      await expect(postResponseLocator.first()).toBeVisible();
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);

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
    const consoleEntry = await po.page.getByTestId("console-entry").last();
    await expect(consoleEntry).toBeVisible({ timeout: Timeout.EXTRA_LONG });

    // Hover over the log entry to reveal the send to chat button
    await consoleEntry.hover();

    // Click the send to chat button (MessageSquare icon)
    const sendToChatButton = consoleEntry.getByTestId("send-to-chat");
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
