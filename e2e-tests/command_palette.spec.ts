import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("command palette supports scoped chat and unfiltered configuration search", async ({
  po,
}) => {
  await po.setUp();
  await po.sendPrompt("tc=1");

  await po.page.keyboard.press("Control+k");
  const palette = po.page.getByTestId("command-palette");
  const input = po.page.getByTestId("command-palette-input");
  await expect(palette).toBeVisible();
  await expect(input).toHaveValue("chat: ");

  await input.fill("chat: tc=1");
  const chatResult = po.page.getByTestId(/^command-palette-chat-/).first();
  await expect(chatResult).toBeVisible();
  await chatResult.click();
  await expect(palette).not.toBeVisible();

  await po.page.keyboard.press("Control+p");
  await expect(input).toHaveValue("");
  await input.fill("Theme");
  await po.page.getByTestId("command-palette-setting-setting-theme").click();
  await expect(po.page).toHaveURL(/\/settings/);
  await expect(po.page.locator("#setting-theme")).toHaveClass(
    /settings-highlight/,
  );

  await po.page.keyboard.press("Control+p");
  await input.fill("environment variables");
  await po.page
    .getByTestId("command-palette-app-setting-environment-variables")
    .click();
  await expect(po.page).toHaveURL(/\/chat/);
  await expect(
    po.page.locator("#app-config-environment-variables"),
  ).toBeVisible();
  await expect(
    po.page.locator("#app-config-environment-variables"),
  ).toHaveClass(/settings-highlight/);

  await po.page.getByTestId("command-palette-trigger").click();
  await expect(input).toHaveValue("");
});
