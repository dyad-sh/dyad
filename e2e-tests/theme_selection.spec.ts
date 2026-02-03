import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("theme selection - dyad-wide default theme is persisted", async ({
  po,
}) => {
  await po.setUp();

  // Verify initial settings state
  const initialSettings = po.recordSettings();
  expect(initialSettings.selectedThemeId).toBe("default");

  // Open menu and select "No Theme"
  await po
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();
  await expect(po.page.getByTestId("theme-option-default")).toBeVisible();
  await po.page.getByTestId("theme-option-none").click();
  await expect(po.page.getByTestId("theme-option-none")).not.toBeVisible();

  // Verify settings file was updated
  expect(po.recordSettings().selectedThemeId).toBe("");

  // Re-open and verify UI shows "No Theme" selected, then select "Default Theme" back
  await po
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();
  await expect(po.page.getByTestId("theme-option-none")).toHaveClass(
    /bg-primary/,
  );
  await po.page.getByTestId("theme-option-default").click();
  await expect(po.page.getByTestId("theme-option-default")).not.toBeVisible();

  // Verify settings file was updated back to default
  expect(po.recordSettings().selectedThemeId).toBe("default");
});

test("theme selection - app-specific theme is persisted", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  // Open menu and select "Default Theme" for this app
  await po
    .getChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();
  await expect(po.page.getByTestId("theme-option-none")).toBeVisible();
  await po.page.getByTestId("theme-option-default").click();
  await expect(po.page.getByTestId("theme-option-default")).not.toBeVisible();

  // Re-open, verify selection, then switch to "No Theme"
  await po
    .getChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();
  await expect(po.page.getByTestId("theme-option-default")).toHaveClass(
    /bg-primary/,
  );
  await po.page.getByTestId("theme-option-none").click();
  await expect(po.page.getByTestId("theme-option-none")).not.toBeVisible();

  // Re-open and verify "No Theme" is selected
  await po
    .getChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();
  await expect(po.page.getByTestId("theme-option-none")).toHaveClass(
    /bg-primary/,
  );
});
