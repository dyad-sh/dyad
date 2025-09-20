import { test } from "./helpers/test_helper";

test("can edit custom provider", async ({ po }) => {
  await po.setUp();
  await po.goToSettingsTab();

  // Create a provider first

  // Edit it
  await po.page.getByTestId("custom-provider-more-options").click();
  await po.page.getByRole("button", { name: "Edit Provider" }).click();

  await po.page.getByRole("textbox", { name: "Display Name" }).clear();
  await po.page
    .getByRole("textbox", { name: "Display Name" })
    .fill("Updated Test Provider");

  await po.page.getByRole("textbox", { name: "API Base URL" }).clear();
  await po.page
    .getByRole("textbox", { name: "API Base URL" })
    .fill("https://api.updated-test.com/v1");

  await po.page.getByRole("button", { name: "Update Provider" }).click();

  // Make sure UI hasn't freezed
});
