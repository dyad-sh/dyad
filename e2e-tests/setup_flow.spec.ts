import {
  testWithConfig,
  Timeout,
  type PageObject,
} from "./helpers/test_helper";
import { expect } from "@playwright/test";
import type { ElectronApplication } from "playwright";

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

    await po.navigation.goToAppsTab();

    await expect(
      po.page.getByRole("heading", { name: "What do you want to build?" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  });

  testSetup(
    "Google API key setup resumes the pending first prompt",
    async ({ po }) => {
      await seedFakeModelSelection(po);
      const prompt = "Build a tiny habit tracker";
      const dialog = await openAiSetupDialog(po, prompt);

      await dialog.getByRole("button", { name: "Google Gemini" }).click();
      await expect(
        po.page.getByRole("heading", { name: "Configure Google" }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await po.page
        .getByPlaceholder(/Enter new Google API Key here/)
        .fill("test-google-key-12345");
      await po.page.getByRole("button", { name: "Save Key" }).click();

      await expect(
        po.page.getByTestId("messages-list").getByText(prompt),
      ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
      await po.chatActions.waitForChatCompletion({
        timeout: Timeout.EXTRA_LONG,
      });
      await expect(po.page.getByRole("dialog")).not.toBeVisible();
      await expectSelectedApp(po);
    },
  );

  testSetup(
    "Dyad Pro return deep link resumes the pending first prompt",
    async ({ po, electronApp }) => {
      const prompt = "Build a tiny workout planner";
      await openAiSetupDialog(po, prompt);

      await triggerDyadProReturnDeepLink(electronApp);

      await expect(
        po.page.getByTestId("messages-list").getByText(prompt),
      ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
      await po.chatActions.waitForChatCompletion({
        timeout: Timeout.EXTRA_LONG,
      });
      await expect(po.page.getByRole("dialog")).not.toBeVisible();
      await expect(po.page.getByText("Welcome to Dyad Pro!")).not.toBeVisible();
      await expectSelectedApp(po);
    },
  );
});

async function expectSelectedApp(po: PageObject) {
  await expect
    .poll(
      async () =>
        await po.page
          .getByTestId("title-bar-app-name-button")
          .getAttribute("data-app-name"),
      { timeout: Timeout.MEDIUM },
    )
    .not.toBe("");
}

async function seedFakeModelSelection(po: PageObject) {
  await po.page.evaluate(async (fakeLlmPort) => {
    const ipcRenderer = (window as any).electron.ipcRenderer;
    await ipcRenderer.invoke("create-custom-language-model-provider", {
      id: "testing",
      name: "test-provider",
      apiBaseUrl: `http://localhost:${fakeLlmPort}/v1`,
    });
    await ipcRenderer.invoke("create-custom-language-model", {
      apiName: "test-model",
      displayName: "test-model",
      providerId: "custom::testing",
    });
    await ipcRenderer.invoke("set-user-settings", {
      selectedModel: {
        provider: "custom::testing",
        name: "test-model",
      },
    });
  }, po.fakeLlmPort);
}

async function triggerDyadProReturnDeepLink(electronApp: ElectronApplication) {
  await electronApp.evaluate(({ app }) => {
    app.emit(
      "open-url",
      { preventDefault: () => {} },
      "dyad://dyad-pro-return?key=test-dyad-pro-key",
    );
  });
}

async function openAiSetupDialog(po: PageObject, prompt = "Build a todo app") {
  await po.navigation.goToAppsTab();
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(async () => {
    await chatInput.fill(prompt, { timeout: 1_000 });
    await expect(chatInput).toContainText(prompt, {
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
