import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("theme selection - dyad-wide default theme is persisted", async ({
  po,
}) => {
  await po.setUp();

  // Verify initial settings state
  const initialSettings = po.settings.recordSettings();
  expect(initialSettings.selectedThemeId).toBe("default");

  // Open menu and select "No Theme"
  await po.chatActions
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();
  await po.page.getByRole("menuitem", { name: "Themes" }).click();
  await expect(po.page.getByTestId("theme-option-default")).toBeVisible();
  await po.page.getByTestId("theme-option-none").click();
  await expect(po.page.getByTestId("theme-option-none")).not.toBeVisible();

  // Verify settings file was updated
  expect(po.settings.recordSettings().selectedThemeId).toBe("");

  // Re-open and verify UI shows "No Theme" selected, then select "Default Theme" back
  await po.chatActions
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
  expect(po.settings.recordSettings().selectedThemeId).toBe("default");
});
