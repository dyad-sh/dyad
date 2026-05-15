import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";

testSkipIfWindows(
  "categories - create, view, rename, and delete",
  async ({ po }) => {
    await po.setUp();

    // Create 2 apps so we have something to categorize.
    const appNames: string[] = [];
    for (let i = 1; i <= 2; i++) {
      if (i > 1) {
        await po.navigation.goToAppsTab();
      }
      await po.sendPrompt("hi");
      const appName = await po.appManagement.getCurrentAppName();
      if (!appName) throw new Error(`App ${i} name not found`);
      appNames.push(appName);
    }
    const [appName1, appName2] = appNames;

    // Navigate to the apps gallery via "See more" on the home page.
    await po.navigation.goToAppsTab();
    await po.page.getByRole("button", { name: "See more" }).first().click();

    // Switch to the Categories tab — should be empty.
    await po.page.getByTestId("apps-view-tab-categories").click();
    await expect(
      po.page.getByText("No categories yet. Create one to organize your apps."),
    ).toBeVisible();

    // Open the add-category dialog and create a category with the first app.
    await po.page.getByTestId("add-category-button").click();
    await po.page.getByTestId("category-name-input").fill("My Test Category");
    await po.page.getByTestId("category-add-apps-picker-trigger").click();
    await po.page
      .getByTestId(/^category-picker-app-\d+$/)
      .first()
      .click();
    // Close the picker popover before clicking submit.
    await po.page.keyboard.press("Escape");
    await po.page.getByTestId("category-submit-button").click();

    // The category folder card should appear with 1 app.
    const folderCard = po.page
      .getByTestId(/^category-folder-\d+$/)
      .filter({ hasText: "My Test Category" });
    await expect(folderCard).toBeVisible();
    await expect(folderCard).toContainText("1 app");

    // Open the category and verify the member app card is visible.
    await folderCard.click();
    await expect(po.page.getByTestId("category-apps-grid")).toBeVisible();
    const memberCards = po.page
      .getByTestId("category-apps-grid")
      .getByTestId(/^app-showcase-card-/);
    await expect(memberCards).toHaveCount(1);
    const memberTestId = await memberCards.first().getAttribute("data-testid");
    const memberAppName = memberTestId?.replace("app-showcase-card-", "");
    expect([appName1, appName2]).toContain(memberAppName);

    // Go back to the categories list.
    await po.page.getByTestId("category-detail-back-button").click();

    // Rename the category via its menu.
    await folderCard.getByTestId(/^category-folder-\d+-menu$/).click();
    await po.page.getByRole("menuitem", { name: "Rename" }).click();
    const nameInput = po.page.getByTestId("category-name-input");
    await nameInput.fill("Renamed Category");
    await po.page.getByTestId("category-submit-button").click();

    const renamedCard = po.page
      .getByTestId(/^category-folder-\d+$/)
      .filter({ hasText: "Renamed Category" });
    await expect(renamedCard).toBeVisible();
    await expect(
      po.page
        .getByTestId(/^category-folder-\d+$/)
        .filter({ hasText: "My Test Category" }),
    ).toHaveCount(0);

    // Delete the category and confirm.
    await renamedCard.getByTestId(/^category-folder-\d+-menu$/).click();
    await po.page.getByRole("menuitem", { name: "Delete" }).click();
    await po.page.getByTestId("category-delete-confirm-button").click();

    // Empty state should return — and the underlying apps must still exist.
    await expect(
      po.page.getByText("No categories yet. Create one to organize your apps."),
    ).toBeVisible();
    await po.page.getByTestId("apps-view-tab-apps").click();
    await expect(
      po.page.getByTestId(`app-showcase-card-${appName1}`),
    ).toBeVisible();
    await expect(
      po.page.getByTestId(`app-showcase-card-${appName2}`),
    ).toBeVisible();
  },
);
