import { testWithConfig, type PageObject } from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup("setup ai provider", async ({ po }) => {
  const dialog = await openAiSetupDialog(po);

  await dialog.getByRole("button", { name: "Google Gemini" }).click();
  await expect(
    po.page.getByRole("heading", { name: "Configure Google" }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Go Back" }).click();
  await openAiSetupDialog(po);
  await po.page.getByRole("button", { name: "OpenRouter" }).click();
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
  await po.chatActions.getChatInput().fill("Build a todo app");
  await po.chatActions
    .getHomeChatInputContainer()
    .getByRole("button", { name: "Send message" })
    .click();
  const dialog = po.page.getByRole("dialog");
  await expect(
    dialog.getByText("Dyad uses AI to build your app."),
  ).toBeVisible();
  return dialog;
}
