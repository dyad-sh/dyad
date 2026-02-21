import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("token bar displays numbers with proper layout", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Send a message to have some token usage
  await po.sendPrompt("tc=basic");

  // Toggle the token bar to show it
  await po.toggleTokenBar();

  // Get the token bar element
  const tokenBar = po.page.getByTestId("token-bar");
  await expect(tokenBar).toBeVisible({ timeout: Timeout.MEDIUM });

  // Verify the token count and percentage are displayed separately
  // The "Tokens:" label should be visible with a number
  await expect(tokenBar).toContainText(/Tokens: [\d,]+/);

  // The percentage should be visible with the context window size
  await expect(tokenBar).toContainText(/\d+% of 128K/);

  // Verify the progress bar exists (it should have colored segments)
  const progressBar = tokenBar.locator(".bg-muted.rounded-full");
  await expect(progressBar).toBeVisible();
});
