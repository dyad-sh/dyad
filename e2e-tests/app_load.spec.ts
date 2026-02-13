import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("app load smoke test", async ({ po }) => {
  await expect(po.page.getByRole("link", { name: "Apps" })).toBeVisible();
  await expect(po.page.getByRole("link", { name: "Settings" })).toBeVisible();

  await po.navigation.goToAppsTab();
  await expect(po.page.getByText("Build a new app")).toBeVisible();
});
