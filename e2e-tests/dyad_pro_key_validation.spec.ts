import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

// The Dyad engine (a LiteLLM proxy) reports invalid keys as an SSE error
// event on an HTTP 200 response rather than an HTTP 401, so this covers the
// in-stream error path of provider API key validation.
test("Dyad Pro key is validated before saving", async ({ po }) => {
  await po.navigation.goToSettingsTab();
  await po.page
    .locator("div")
    .filter({ hasText: /^DyadNeeds Setup$/ })
    .nth(1)
    .click();

  const keyInput = po.page.getByRole("textbox", { name: "Set Dyad API Key" });
  await keyInput.fill("invalid-dyad-key");
  await po.page.getByRole("button", { name: "Save Key" }).click();

  const validationDialog = po.page.getByRole("alertdialog");
  await expect(
    validationDialog.getByRole("heading", { name: "API key check failed" }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(
    validationDialog.getByText(/Dyad rejected this API key/),
  ).toBeVisible();
  await validationDialog
    .getByRole("button", { name: "Try another API key" })
    .click();
  await expect(validationDialog).toBeHidden({ timeout: Timeout.MEDIUM });

  const settingsAfterRetry = po.settings.recordSettings() as {
    providerSettings?: Record<string, unknown>;
    enableDyadPro?: boolean;
  };
  expect(settingsAfterRetry.providerSettings?.auto).toBe(undefined);
  expect(settingsAfterRetry.enableDyadPro).not.toBe(true);

  await keyInput.fill("testdyadkey");
  await po.page.getByRole("button", { name: "Save Key" }).click();

  await expect(po.page.getByText("Current Key (Settings)")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  const settingsAfterSave = po.settings.recordSettings() as {
    providerSettings?: Record<string, unknown>;
    enableDyadPro?: boolean;
  };
  expect(settingsAfterSave.providerSettings?.auto).toBeDefined();
  expect(settingsAfterSave.enableDyadPro).toBe(true);
});
