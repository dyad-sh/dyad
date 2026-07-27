import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("themes management - CRUD operations", async ({ po }) => {
  await po.setUp();

  // Navigate to Themes page via Library sidebar
  await po.navigation.goToLibraryTab();
  await po.page.getByRole("link", { name: "Themes" }).click();
  await expect(po.page.getByRole("heading", { name: "Themes" })).toBeVisible();

  // Verify no themes exist initially
  await expect(
    po.page.getByText("No custom themes yet. Create one to get started."),
  ).toBeVisible();

  // === CREATE ===
  // Click New Theme button
  await po.page.getByRole("button", { name: "New Theme" }).click();

  // Wait for dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Create Custom Theme"),
  ).toBeVisible();

  // Fill in manual configuration form
  await po.page.locator("#manual-name").fill("My Test Theme");
  await po.page.locator("#manual-description").fill("A test theme description");
  await po.page
    .locator("#manual-prompt")
    .fill("Use blue colors and modern styling");

  // Save the theme
  await po.page.getByRole("button", { name: "Save Theme" }).click();

  // Verify dialog closes and theme card appears
  await expect(po.page.getByRole("dialog")).not.toBeVisible();
  await expect(po.page.getByTestId("library-theme-card")).toBeVisible();
  await expect(po.page.getByText("My Test Theme")).toBeVisible();
  await expect(po.page.getByText("A test theme description")).toBeVisible();

  // === UPDATE ===
  // Click edit button on the theme card
  await po.page.getByTestId("edit-theme-button").click();

  // Wait for edit dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Edit Theme"),
  ).toBeVisible();

  // Update the theme details (edit dialog uses different input IDs)
  await po.page.getByRole("dialog").getByLabel("Theme Name").clear();
  await po.page
    .getByRole("dialog")
    .getByLabel("Theme Name")
    .fill("Updated Theme");
  await po.page
    .getByRole("dialog")
    .getByLabel("Description (optional)")
    .fill("Updated description");
  await po.page.getByRole("dialog").getByLabel("Theme Prompt").clear();
  await po.page
    .getByRole("dialog")
    .getByLabel("Theme Prompt")
    .fill("Updated prompt content");

  // Save changes
  await po.page.getByRole("button", { name: "Save" }).click();

  // Verify dialog closes and updated content appears
  await expect(po.page.getByRole("dialog")).not.toBeVisible();
  await expect(po.page.getByText("Updated Theme")).toBeVisible();
  await expect(po.page.getByText("Updated description")).toBeVisible();
  await expect(po.page.getByText("Updated prompt content")).toBeVisible();

  // Verify old name is gone
  await expect(po.page.getByText("My Test Theme")).not.toBeVisible();

  // === DELETE ===
  // Click delete button on the theme card
  await po.page.getByTestId("delete-prompt-button").click();

  // Verify delete confirmation dialog appears
  await expect(po.page.getByRole("alertdialog")).toBeVisible();
  await expect(po.page.getByText("Delete Theme")).toBeVisible();
  await expect(
    po.page.getByText('Are you sure you want to delete "Updated Theme"?'),
  ).toBeVisible();

  // Confirm deletion
  await po.page.getByRole("button", { name: "Delete" }).click();

  // Verify dialog closes and theme is removed
  await expect(po.page.getByRole("alertdialog")).not.toBeVisible();
  await expect(po.page.getByText("Updated Theme")).not.toBeVisible();

  // Verify empty state is shown again
  await expect(
    po.page.getByText("No custom themes yet. Create one to get started."),
  ).toBeVisible();
});

test("themes management - create theme from chat input", async ({ po }) => {
  await po.setUp();

  // Open the auxiliary actions menu
  await po.chatActions
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();

  // Hover over Themes submenu
  await po.page.getByRole("menuitem", { name: "Themes" }).click();

  // Click "New Theme" option
  await po.page.getByRole("menuitem", { name: "New Theme" }).click();

  // Wait for dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Create Custom Theme"),
  ).toBeVisible();

  // Fill in manual configuration form
  await po.page.locator("#manual-name").fill("Chat Input Theme");
  await po.page.locator("#manual-description").fill("Created from chat input");
  await po.page
    .locator("#manual-prompt")
    .fill("Use dark mode with purple accents");

  // Save the theme
  await po.page.getByRole("button", { name: "Save Theme" }).click();

  // Verify dialog closes
  await expect(po.page.getByRole("dialog")).not.toBeVisible();

  // Verify the newly created theme is auto-selected
  // Re-open the menu to verify
  await po.chatActions
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();

  // The custom theme should be visible and selected (has bg-primary class)
  await expect(po.page.getByTestId("theme-option-custom:1")).toHaveClass(
    /bg-primary/,
  );
});
