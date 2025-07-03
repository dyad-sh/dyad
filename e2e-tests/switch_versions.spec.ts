import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const runSwitchVersionTest = async (po: PageObject, nativeGit: boolean) => {
  await po.setUp({ autoApprove: true, nativeGit });
  await po.sendPrompt("tc=write-index");

  await po.snapshotPreview({ name: `v2` });

  expect(
    await po.page.getByRole("button", { name: "Version" }).textContent(),
  ).toBe("Version 2");
  await po.page.getByRole("button", { name: "Version" }).click();
  await po.page.getByText("Init Dyad app Restore").click();
  await po.snapshotPreview({ name: `v1` });

  await po.page
    .getByRole("button", { name: "Restore to this version" })
    .click();
  // Should be same as the previous snapshot, but just to be sure.
  await po.snapshotPreview({ name: `v1` });

  await expect(po.page.getByText("Version 3")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
};

testSkipIfWindows("switch versions", async ({ po }) => {
  await runSwitchVersionTest(po, false);
});

testSkipIfWindows("switch versions with native git", async ({ po }) => {
  await runSwitchVersionTest(po, true);
});
