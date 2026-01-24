import { PageObject, testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const runSwitchVersionTest = async (
  po: PageObject,
  disableNativeGit: boolean,
) => {
  await po.setUp({ autoApprove: true, disableNativeGit });
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

testSkipIfWindows("switch versions (native git)", async ({ po }) => {
  await runSwitchVersionTest(po, false);
});

testSkipIfWindows("switch versions (isomorphic git)", async ({ po }) => {
  await runSwitchVersionTest(po, true);
});

// Test: Restoring to a version from the SAME chat should NOT create a new chat
testSkipIfWindows(
  "restore version from same chat does not create new chat",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("tc=write-index");

    await po.sendPrompt("tc=write-index-2");

    await expect(
      po.page.getByRole("button", { name: "Version 3" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.page.getByRole("button", { name: "Version 3" }).click();

    await po.page.getByText(/Version 2 \(/).click();

    await po.page
      .getByRole("button", { name: "Restore to this version" })
      .click();

    await expect(po.page.getByText("Version 4")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    // Since restoring to a version from the SAME chat, we should NOT see the toast
    // about switching to a new chat
    await expect(
      po.page.getByText(
        "We've switched you to a new chat to give the AI a clean context.",
      ),
    ).not.toBeVisible({ timeout: Timeout.MEDIUM });
  },
);

// Test: Restoring to a version from a DIFFERENT chat should create a new chat
testSkipIfWindows(
  "restore version from different chat creates new chat",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.sendPrompt("tc=write-index");

    await po.clickNewChat();

    await expect(po.getChatInput()).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.sendPrompt("tc=write-index-2");

    await expect(
      po.page.getByRole("button", { name: "Version 3" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    await po.page.getByRole("button", { name: "Version 3" }).click();
    await po.page.getByText(/Version 2 \(/).click();

    await po.page
      .getByRole("button", { name: "Restore to this version" })
      .click();

    // Since restoring to a version from a DIFFERENT chat, we SHOULD see the toast
    await expect(
      po.page.getByText(
        "We've switched you to a new chat to give the AI a clean context.",
      ),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await expect(po.page.getByText("Version 4")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
  },
);
