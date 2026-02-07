import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("themes management - CRUD operations", async ({ po }) => {
  await po.setUp();

  // Navigate to Themes page via Library sidebar
  await po.goToLibraryTab();
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

  // Switch to Manual tab
  await po.page.getByRole("tab", { name: "Manual Configuration" }).click();

  // Fill in manual configuration form
  await po.page.getByLabel("Theme Name").fill("My Test Theme");
  await po.page
    .getByLabel("Description (optional)")
    .fill("A test theme description");
  await po.page
    .getByLabel("Theme Prompt")
    .fill("Use blue colors and modern styling");

  // Save the theme
  await po.page.getByRole("button", { name: "Save Theme" }).click();

  // Verify dialog closes and theme card appears
  await expect(po.page.getByRole("dialog")).not.toBeVisible();
  await expect(po.page.getByTestId("theme-card")).toBeVisible();
  await expect(po.page.getByText("My Test Theme")).toBeVisible();
  await expect(po.page.getByText("A test theme description")).toBeVisible();

  // === UPDATE ===
  // Click edit button on the theme card
  await po.page.getByTestId("edit-theme-button").click();

  // Wait for edit dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Edit Theme"),
  ).toBeVisible();

  // Update the theme details
  await po.page.getByLabel("Theme Name").clear();
  await po.page.getByLabel("Theme Name").fill("Updated Theme");
  await po.page
    .getByLabel("Description (optional)")
    .fill("Updated description");
  await po.page.getByLabel("Theme Prompt").clear();
  await po.page.getByLabel("Theme Prompt").fill("Updated prompt content");

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
  await po
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

  // Switch to Manual tab (AI tab is now default)
  await po.page.getByRole("tab", { name: "Manual Configuration" }).click();

  // Fill in manual configuration form
  await po.page.getByLabel("Theme Name").fill("Chat Input Theme");
  await po.page
    .getByLabel("Description (optional)")
    .fill("Created from chat input");
  await po.page
    .getByLabel("Theme Prompt")
    .fill("Use dark mode with purple accents");

  // Save the theme
  await po.page.getByRole("button", { name: "Save Theme" }).click();

  // Verify dialog closes
  await expect(po.page.getByRole("dialog")).not.toBeVisible();

  // Verify the newly created theme is auto-selected
  // Re-open the menu to verify
  await po
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();

  // The custom theme should be visible and selected (has bg-primary class)
  await expect(po.page.getByTestId("theme-option-custom:1")).toHaveClass(
    /bg-primary/,
  );
});

test("themes management - AI generator image upload limit", async ({ po }) => {
  await po.setUpDyadPro();

  // Navigate to Themes page via Library sidebar
  await po.goToLibraryTab();
  await po.page.getByRole("link", { name: "Themes" }).click();
  await expect(po.page.getByRole("heading", { name: "Themes" })).toBeVisible();

  // Click New Theme button
  await po.page.getByRole("button", { name: "New Theme" }).click();

  // Wait for dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Create Custom Theme"),
  ).toBeVisible();

  // Verify AI-Powered Generator tab is active by default
  const aiTab = po.page.getByRole("tab", { name: "AI-Powered Generator" });
  await expect(aiTab).toHaveAttribute("data-active", "");

  // Verify upload area is visible
  const uploadArea = po.page.getByText("Click to upload images");
  await expect(uploadArea).toBeVisible();

  // Set up file chooser listener BEFORE clicking the upload area
  const fileChooserPromise = po.page.waitForEvent("filechooser");

  // Click the upload area to trigger file picker
  await uploadArea.click();

  // Handle the file chooser dialog - select the same image 7 times (exceeds 5 limit)
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles([
    "e2e-tests/fixtures/images/logo.png",
    "e2e-tests/fixtures/images/logo.png",
    "e2e-tests/fixtures/images/logo.png",
    "e2e-tests/fixtures/images/logo.png",
    "e2e-tests/fixtures/images/logo.png",
    "e2e-tests/fixtures/images/logo.png",
    "e2e-tests/fixtures/images/logo.png",
  ]);

  // Verify that only 5 images were uploaded (max limit)
  await expect(po.page.getByText("5 / 5 images")).toBeVisible();
  await expect(po.page.getByText("Maximum reached")).toBeVisible();

  // Verify error toast appeared about skipped images
  await expect(po.page.getByText(/files? (was|were) skipped/)).toBeVisible();
});

test("themes management - AI generator flow", async ({ po }) => {
  await po.setUp();

  // Navigate to Themes page via Library sidebar
  await po.goToLibraryTab();
  await po.page.getByRole("link", { name: "Themes" }).click();
  await expect(po.page.getByRole("heading", { name: "Themes" })).toBeVisible();

  // Verify no themes exist initially
  await expect(
    po.page.getByText("No custom themes yet. Create one to get started."),
  ).toBeVisible();

  // Click New Theme button
  await po.page.getByRole("button", { name: "New Theme" }).click();

  // Wait for dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Create Custom Theme"),
  ).toBeVisible();

  // Verify AI-Powered Generator tab is active by default
  const aiTab = po.page.getByRole("tab", { name: "AI-Powered Generator" });
  await expect(aiTab).toHaveAttribute("data-active", "");

  // Verify upload area is visible
  const uploadArea = po.page.getByText("Click to upload images");
  await expect(uploadArea).toBeVisible();

  // Verify Generate button is disabled before uploading images
  const generateButton = po.page.getByRole("button", {
    name: "Generate Theme Prompt",
  });
  await expect(generateButton).toBeDisabled();

  // Fill in theme details
  await po.page.getByLabel("Theme Name").fill("AI Generated Theme");
  await po.page
    .getByLabel("Description (optional)")
    .fill("Created via AI generator");

  // Upload an image
  const fileChooserPromise = po.page.waitForEvent("filechooser");
  await uploadArea.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(["e2e-tests/fixtures/images/logo.png"]);

  // Verify image counter shows 1 image
  await expect(po.page.getByText("1 / 5 images")).toBeVisible();

  // Verify Generate button is now enabled
  await expect(generateButton).toBeEnabled();

  // Click Generate to get mock theme prompt (test mode returns mock response)
  await generateButton.click();

  // Wait for generation to complete - the generated prompt textarea should appear
  await expect(po.page.locator("#ai-prompt")).toBeVisible({ timeout: 10000 });

  // Verify the mock theme content is displayed
  await expect(po.page.getByText("Test Mode Theme")).toBeVisible();

  // Save the theme
  await po.page.getByRole("button", { name: "Save Theme" }).click();

  // Verify dialog closes and theme card appears
  await expect(po.page.getByRole("dialog")).not.toBeVisible();
  await expect(po.page.getByTestId("theme-card")).toBeVisible();
  await expect(po.page.getByText("AI Generated Theme")).toBeVisible();
  await expect(po.page.getByText("Created via AI generator")).toBeVisible();
});

test("themes management - AI generator from website URL", async ({ po }) => {
  await po.setUpDyadPro();

  // Navigate to Themes page via Library sidebar
  await po.goToLibraryTab();
  await po.page.getByRole("link", { name: "Themes" }).click();
  await expect(po.page.getByRole("heading", { name: "Themes" })).toBeVisible();

  // Click New Theme button
  await po.page.getByRole("button", { name: "New Theme" }).click();

  // Wait for dialog to open
  await expect(
    po.page.getByRole("dialog").getByText("Create Custom Theme"),
  ).toBeVisible();

  // Verify AI-Powered Generator tab is active by default
  const aiTab = po.page.getByRole("tab", { name: "AI-Powered Generator" });
  await expect(aiTab).toHaveAttribute("data-active", "");

  // Switch to Website URL input source
  await po.page.getByRole("button", { name: "Website URL" }).click();

  // Verify URL input is visible
  const urlInput = po.page.getByLabel("Website URL");
  await expect(urlInput).toBeVisible();

  // Verify Generate button is disabled before entering URL
  const generateButton = po.page.getByRole("button", {
    name: "Generate Theme Prompt",
  });
  await expect(generateButton).toBeDisabled();

  // Fill in theme details
  await po.page.getByLabel("Theme Name").fill("Website Theme");
  await po.page
    .getByLabel("Description (optional)")
    .fill("Generated from website");

  // Enter a website URL
  await urlInput.fill("https://example.com");

  // Verify Generate button is now enabled
  await expect(generateButton).toBeEnabled();

  // Click Generate to get mock theme prompt (test mode returns mock response)
  await generateButton.click();

  // Wait for generation to complete - the generated prompt textarea should appear
  await expect(po.page.locator("#ai-prompt")).toBeVisible({ timeout: 10000 });

  // Verify the mock theme content is displayed (URL-specific mock)
  await expect(po.page.getByText("Test Mode Theme (from URL)")).toBeVisible();

  // Save the theme
  await po.page.getByRole("button", { name: "Save Theme" }).click();

  // Verify dialog closes and theme card appears
  await expect(po.page.getByRole("dialog")).not.toBeVisible();
  const themeCard = po.page.getByTestId("theme-card");
  await expect(themeCard).toBeVisible();
  await expect(themeCard.getByText("Website Theme")).toBeVisible();
  await expect(themeCard.getByText("Generated from website")).toBeVisible();
});
