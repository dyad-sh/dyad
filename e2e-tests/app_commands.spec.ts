import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("configure app commands", async ({ po }) => {
  // Create an app first
  await po.sendPrompt("tc=1");

  // Navigate to configure panel
  await po.selectPreviewMode("configure");

  // Verify default state - no custom commands
  await expect(
    po.page.getByText("Using default install and start commands"),
  ).toBeVisible();

  // --- Validation: both commands are required ---

  // Click to configure custom commands
  await po.page.getByTestId("configure-app-commands").click();

  // Fill in only install command (leaving start command empty)
  await po.page.getByTestId("install-command-input").fill("npm install");

  // Verify validation message appears
  await expect(
    po.page.getByText("Both commands are required when customizing."),
  ).toBeVisible();

  // Verify save button is disabled
  const saveButton = po.page.getByTestId("save-app-commands");
  await expect(saveButton).toBeDisabled();

  // Now fill in both commands
  await po.page.getByTestId("start-command-input").fill("npm run dev");

  // Validation message should disappear
  await expect(
    po.page.getByText("Both commands are required when customizing."),
  ).not.toBeVisible();

  // Save button should be enabled
  await expect(saveButton).toBeEnabled();

  // --- Cancel editing ---

  // Cancel instead of saving
  await po.page.getByTestId("cancel-edit-app-commands").click();

  // Verify we're back to default state (commands were not saved)
  await expect(
    po.page.getByText("Using default install and start commands"),
  ).toBeVisible();

  // --- Configure, edit, and clear commands ---

  // Click to configure custom commands again
  await po.page.getByTestId("configure-app-commands").click();

  // Fill in custom install command
  await po.page.getByTestId("install-command-input").click();
  await po.page.getByTestId("install-command-input").fill("npm install");

  // Fill in custom start command
  await po.page.getByTestId("start-command-input").click();
  await po.page.getByTestId("start-command-input").fill("npm run dev");

  // Save the commands
  await po.page.getByTestId("save-app-commands").click();

  // Verify success toast
  await po.waitForToastWithText("App commands saved");

  // Verify the commands are displayed
  await expect(po.page.getByTestId("current-install-command")).toHaveText(
    "npm install",
  );
  await expect(po.page.getByTestId("current-start-command")).toHaveText(
    "npm run dev",
  );

  // Test editing existing commands
  await po.page.getByTestId("edit-app-commands").click();

  // Update the commands
  await po.page.getByTestId("install-command-input").fill("pnpm install");
  await po.page.getByTestId("start-command-input").fill("pnpm dev --port 3001");

  // Save the updated commands
  await po.page.getByTestId("save-app-commands").click();

  // Verify the updated commands are displayed
  await expect(po.page.getByTestId("current-install-command")).toHaveText(
    "pnpm install",
  );
  await expect(po.page.getByTestId("current-start-command")).toHaveText(
    "pnpm dev --port 3001",
  );

  // Test clearing commands
  await po.page.getByTestId("clear-app-commands").click();

  // Verify commands are cleared and default message is shown again
  await expect(
    po.page.getByText("Using default install and start commands"),
  ).toBeVisible();
});
