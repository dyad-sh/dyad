import { test } from "./helpers/test_helper";

test("delete custom provider should not freeze", async ({ po }) => {
  await po.setUp();
  await po.goToSettingsTab();
  await po.page.getByTestId("custom-provider-more-options").click();
  await po.page.getByRole("button", { name: "Delete Provider" }).click();
  await po.page.getByRole("button", { name: "Delete Provider" }).click();

  // Make sure UI hasn't freezed
  await po.goToAppsTab();
});
