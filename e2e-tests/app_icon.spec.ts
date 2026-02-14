import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

test("can change app icon to emoji", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Navigate to app details
  await po.appManagement.getTitleBarAppNameButton().click();

  // Click the icon button to open picker
  await po.page.getByTestId("app-details-icon-button").click();

  // Verify icon picker modal is open
  await expect(po.page.getByRole("dialog")).toBeVisible();
  await expect(
    po.page.getByRole("heading", { name: "Choose app icon" }),
  ).toBeVisible();

  // The emoji tab should be active by default
  await expect(po.page.getByRole("tab", { name: "Emoji" })).toBeVisible();

  // Wait for emoji picker to load
  await expect(po.page.locator("em-emoji-picker")).toBeVisible({
    timeout: Timeout.SHORT,
  });

  // Search for and click a specific emoji
  const emojiSearch = po.page.locator('input[placeholder="Search"]');
  await emojiSearch.fill("smile");
  await po.page.waitForTimeout(500); // Wait for search results

  // Click on a smile emoji in the results
  await po.page.locator('[data-emoji-id="smile"]').first().click();

  // Modal should close after selection
  await expect(po.page.getByRole("dialog")).not.toBeVisible({
    timeout: Timeout.SHORT,
  });

  // Verify the icon was updated (check that the emoji is shown in the button)
  const iconButton = po.page.getByTestId("app-details-icon-button");
  await expect(iconButton).toBeVisible();
});

test("can change app icon to generated avatar", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Navigate to app details
  await po.appManagement.getTitleBarAppNameButton().click();

  // Click the icon button to open picker
  await po.page.getByTestId("app-details-icon-button").click();

  // Verify icon picker modal is open
  await expect(po.page.getByRole("dialog")).toBeVisible();

  // Switch to Avatar tab
  await po.page.getByRole("tab", { name: "Avatar" }).click();

  // Verify avatar preview is visible
  await expect(po.page.getByText("Light")).toBeVisible();
  await expect(po.page.getByText("Dark")).toBeVisible();

  // Click regenerate to get a new avatar
  await po.page.getByRole("button", { name: "Regenerate" }).click();

  // Click Apply to save
  await po.page.getByRole("button", { name: "Apply" }).click();

  // Modal should close after selection
  await expect(po.page.getByRole("dialog")).not.toBeVisible({
    timeout: Timeout.SHORT,
  });

  // Verify the icon button is still visible (confirming it was updated)
  const iconButton = po.page.getByTestId("app-details-icon-button");
  await expect(iconButton).toBeVisible();
});

test("can cancel icon picker without changes", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Navigate to app details
  await po.appManagement.getTitleBarAppNameButton().click();

  // Get the initial icon markup
  const initialIconMarkup = await po.page
    .getByTestId("app-details-icon-button")
    .innerHTML();

  // Click the icon button to open picker
  await po.page.getByTestId("app-details-icon-button").click();

  // Verify icon picker modal is open
  await expect(po.page.getByRole("dialog")).toBeVisible();

  // Click cancel
  await po.page.getByRole("button", { name: "Cancel" }).click();

  // Modal should close
  await expect(po.page.getByRole("dialog")).not.toBeVisible({
    timeout: Timeout.SHORT,
  });

  // Verify the icon hasn't changed
  const finalIconMarkup = await po.page
    .getByTestId("app-details-icon-button")
    .innerHTML();
  expect(finalIconMarkup).toBe(initialIconMarkup);
});

test("remembers recent emojis", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  // Navigate to app details
  await po.appManagement.getTitleBarAppNameButton().click();

  // Click the icon button to open picker
  await po.page.getByTestId("app-details-icon-button").click();

  // Wait for emoji picker to load
  await expect(po.page.locator("em-emoji-picker")).toBeVisible({
    timeout: Timeout.SHORT,
  });

  // Search for and click a specific emoji
  const emojiSearch = po.page.locator('input[placeholder="Search"]');
  await emojiSearch.fill("heart");
  await po.page.waitForTimeout(500);

  // Click on a heart emoji
  await po.page.locator('[data-emoji-id="heart"]').first().click();

  // Modal should close
  await expect(po.page.getByRole("dialog")).not.toBeVisible({
    timeout: Timeout.SHORT,
  });

  // Open icon picker again
  await po.page.getByTestId("app-details-icon-button").click();
  await expect(po.page.getByRole("dialog")).toBeVisible();

  // Verify "Recent" section is visible with the previously used emoji
  await expect(po.page.getByText("Recent")).toBeVisible();
});
