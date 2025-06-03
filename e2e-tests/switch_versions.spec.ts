import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("switch versions", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.sendPrompt("tc=write-index");

  await po.snapshotPreview();

  expect(
    await po.page.getByRole("button", { name: "Version" }).textContent(),
  ).toBe("Version 2");
  await po.page.getByRole("button", { name: "Version" }).click();
  await po.page.getByText("Init Dyad app Undo").click();
  await po.snapshotPreview();

  await po.page.getByRole("button", { name: "Undo to latest version" }).click();
  // Should be same as the previous snapshot, but just to be sure.
  await po.snapshotPreview();

  await expect(po.page.getByText("Version 3")).toBeVisible();
});
