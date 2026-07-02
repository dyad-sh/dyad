import {
  testWithConfig,
  Timeout,
  type PageObject,
} from "./helpers/test_helper";
import { expect } from "@playwright/test";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup.describe("Setup Flow", () => {
  testSetup("setup dialog shows AI provider options", async ({ po }) => {
    const dialog = await openAiSetupDialog(po);

    await expect(
      dialog.getByText("Dyad uses AI to build your app."),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Start free Dyad Pro trial/ }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Google Gemini" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "OpenRouter" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Other providers" }),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Already have Dyad Pro? Add your key",
      }),
    ).toBeVisible();
  });

  testSetup("AI provider setup flow", async ({ po }) => {
    let dialog = await openAiSetupDialog(po);

    await dialog.getByRole("button", { name: "Google Gemini" }).click();
    await expect(
      po.page.getByRole("heading", { name: "Configure Google" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.page.getByRole("button", { name: "Go Back" }).click();

    dialog = await openAiSetupDialog(po);
    await dialog.getByRole("button", { name: "OpenRouter" }).click();
    await expect(
      po.page.getByRole("heading", { name: "Configure OpenRouter" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await po.page.getByRole("button", { name: "Go Back" }).click();

    dialog = await openAiSetupDialog(po);
    await dialog.getByRole("button", { name: "Other providers" }).click();
    await expect(
      po.page.getByRole("heading", { level: 1, name: "Settings" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    await po.settings.setUpTestProvider();
    await po.page.getByRole("heading", { name: "test-provider" }).click();
    await po.settings.setUpTestProviderApiKey();
    await po.settings.setUpTestModel();

    await po.navigation.goToAppsTab();

    await expect(
      po.page.getByRole("heading", { name: "What do you want to build?" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  });
});

async function openAiSetupDialog(po: PageObject) {
  await po.navigation.goToAppsTab();
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(async () => {
    await chatInput.fill("Build a todo app", { timeout: 1_000 });
    await expect(chatInput).toContainText("Build a todo app", {
      timeout: 1_000,
    });
    await expect(
      po.chatActions
        .getHomeChatInputContainer()
        .getByRole("button", { name: "Send message" }),
    ).toBeEnabled({ timeout: 1_000 });
  }).toPass({ timeout: Timeout.MEDIUM });

  await po.chatActions
    .getHomeChatInputContainer()
    .getByRole("button", { name: "Send message" })
    .click();

  const dialog = po.page.getByRole("dialog");
  await expect(dialog.getByText("Dyad uses AI to build your app.")).toBeVisible(
    { timeout: Timeout.MEDIUM },
  );
  return dialog;
}
