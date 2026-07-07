import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("renders the first page", async ({ po }) => {
  const heading = po.page.locator("h1");
  await expect(heading).toBeVisible();
  await expect(heading).toHaveText("What do you want to build?");
});
