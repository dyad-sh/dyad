import * as os from "os";
import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test.skip(
  os.platform() !== "darwin",
  "macOS notification guide is platform-specific",
);

test("notification banner - Enable shows macOS notification guide", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  const banner = po.page.getByTestId("notification-tip-banner");
  await expect(banner).toBeVisible();

  await banner.getByRole("button", { name: "Enable" }).click();

  const guideDialog = po.page.getByRole("dialog");
  await expect(guideDialog).toBeVisible();
  await guideDialog.getByRole("button", { name: "Got it" }).click();
  await expect(guideDialog).not.toBeVisible();
});
