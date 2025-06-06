import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

const tests = [
  {
    testName: "with history",
    newAppName: "copied-app-with-history",
    buttonName: "Copy app with history",
    expectedVersion: "Version 2",
  },
  {
    testName: "without history",
    newAppName: "copied-app-without-history",
    buttonName: "Copy app without history",
    expectedVersion: "Version 1",
  },
];

for (const { testName, newAppName, buttonName, expectedVersion } of tests) {
  test(`copy app ${testName}`, async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("hi");
    await po.snapshotAppFiles({ name: "app" });

    await po.getTitleBarAppNameButton().click();

    // Open the dropdown menu
    await po.clickAppDetailsMoreOptions();
    await po.clickAppDetailsCopyAppButton();

    await po.page.getByLabel("New app name").fill(newAppName);

    // Click the "Copy app" button
    await po.page.getByRole("button", { name: buttonName }).click();

    // Expect to be on the new app's detail page
    await expect(
      po.page.getByRole("heading", { name: newAppName }),
    ).toBeVisible({
      // Potentially takes a while for the copy to complete
      timeout: Timeout.MEDIUM,
    });

    const currentAppName = await po.getCurrentAppName();
    expect(currentAppName).toBe(newAppName);

    await po.clickOpenInChatButton();

    await expect(po.page.getByText(expectedVersion)).toBeVisible();
    await po.snapshotAppFiles({ name: "app" });
  });
}
