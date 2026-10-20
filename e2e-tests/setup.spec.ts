import { testWithConfig, type PageObject } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup("setup ai provider", async ({ po }) => {
  const dialog = await openAiSetupDialog(po);
  const providerButtons = dialog.getByRole("button", {
    name: /ChatGPT subscription|OpenRouter|Other providers/,
  });

  await expect(providerButtons.nth(0)).toHaveAccessibleName(
    /ChatGPT subscription/,
  );
  await expect(providerButtons.nth(1)).toHaveAccessibleName(/OpenRouter/);

  await dialog.getByRole("button", { name: "Other providers" }).click();
  await po.page
    .getByRole("heading", { name: /^Google\s*(?:Needs Setup|Ready)$/ })
    .click();
  await expect(
    po.page.getByRole("heading", { name: "Configure Google" }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await openAiSetupDialog(po);
  await po.page.getByRole("button", { name: /OpenRouter/ }).click();
  await expect(
    po.page.getByRole("heading", { name: "Configure OpenRouter" }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await openAiSetupDialog(po);
  await po.page.getByRole("button", { name: "Other providers" }).click();
  await expect(
    po.page.getByRole("heading", { level: 1, name: "Settings" }),
  ).toBeVisible();
});

async function openAiSetupDialog(po: PageObject) {
  await po.navigation.goToAppsTab();
  await po.chatActions.getChatInput().fill("Build a todo app");
  await po.chatActions
    .getHomeChatInputContainer()
    .getByRole("button", { name: "Send message" })
    .click();
  const dialog = po.page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: /ChatGPT subscription/ }),
  ).toBeVisible();
  return dialog;
}
