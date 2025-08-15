import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("edit custom model", async ({ po }) => {
  await po.setUp();
  await po.goToSettingsTab();
  await po.page.getByText("test-provider").click();

  // test edit model by double clicking the model panel
  await po.page
    .locator(".text-lg.font-semibold", { hasText: "test-model" })
    .dblclick({ delay: 100 });
  await po.page.locator("#edit-model-id").clear();
  await po.page.locator("#edit-model-id").fill("new-model-id");
  await po.page.locator("#edit-model-name").clear();
  await po.page.locator("#edit-model-name").fill("new-model-name");
  await po.page.getByRole("button", { name: "Update Model" }).click();

  // assert that the model was updated
  await po.page
    .locator(".text-lg.font-semibold", { hasText: "new-model-name" })
    .dblclick({ delay: 100 });
  await expect(po.page.locator("#edit-model-id")).toHaveValue("new-model-id");
  await expect(po.page.locator("#edit-model-name")).toHaveValue(
    "new-model-name",
  );
  await po.page.getByRole("button", { name: "Cancel" }).click();

  // test edit model by clicking the edit button
  await po.page
    .locator('button svg path[d*="M11 5H6a2"]')
    .locator("..")
    .locator("..")
    .click();
  await po.page.locator("#edit-model-id").clear();
  await po.page.locator("#edit-model-id").fill("another-model-id");
  await po.page.locator("#edit-model-name").clear();
  await po.page.locator("#edit-model-name").fill("another-model-name");
  await po.page.getByRole("button", { name: "Update Model" }).click();

  // assert that the model was updated
  await po.page
    .locator(".text-lg.font-semibold", { hasText: "another-model-name" })
    .dblclick({ delay: 100 });
  await expect(po.page.locator("#edit-model-id")).toHaveValue(
    "another-model-id",
  );
  await expect(po.page.locator("#edit-model-name")).toHaveValue(
    "another-model-name",
  );
  await po.page.getByRole("button", { name: "Cancel" }).click();

  // Make sure UI hasn't freezed
  await po.goToAppsTab();
});
