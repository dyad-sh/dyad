import {
  testWithConfig,
  Timeout,
  type PageObject,
} from "./helpers/test_helper";
import { expect } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import * as fs from "fs";

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
    "Google API key setup resumes an attachment-only first prompt",
    async ({ po }) => {
      await seedFakeModelSelection(po);
      const attachmentPath =
        "e2e-tests/fixtures/attachment-only-setup-resume.txt";
      const dialog = await openAiSetupDialog(po, "", {
        beforeSubmit: async () => {
          await attachHomeChatContextFile(po, attachmentPath);
        },
      });

      await dialog.getByRole("button", { name: "Google Gemini" }).click();
      await expect(
        po.page.getByRole("heading", { name: "Configure Google" }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await po.page
        .getByPlaceholder(/Enter new Google API Key here/)
        .fill("test-google-key-12345");
      await po.page.getByRole("button", { name: "Save Key" }).click();

      await expect(po.page.getByText("[[dyad-dump-path=")).toBeVisible({
        timeout: Timeout.EXTRA_LONG,
      });
      await po.chatActions.waitForChatCompletion({
        timeout: Timeout.EXTRA_LONG,
      });
      await expect(po.page.getByRole("dialog")).not.toBeVisible();
      await expectSelectedApp(po);

      const dump = await readLastServerDump(po);
      const serializedDump = JSON.stringify(dump);
      expect(serializedDump).toContain("attachment-only-setup-resume.txt");
      expect(serializedDump).toContain("Attachment-only setup resume fixture.");
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

async function openAiSetupDialog(
  po: PageObject,
  prompt = "Build a todo app",
  options: { beforeSubmit?: () => Promise<void> } = {},
) {
  await po.navigation.goToAppsTab();
  const chatInput = po.chatActions.getChatInput();
  await expect(chatInput).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(async () => {
    await chatInput.fill(prompt, { timeout: 1_000 });
    await expect(chatInput).toContainText(prompt, {
      timeout: 1_000,
    });
    if (prompt.trim()) {
      await expect(
        po.chatActions
          .getHomeChatInputContainer()
          .getByRole("button", { name: "Send message" }),
      ).toBeEnabled({ timeout: 1_000 });
    }
  }).toPass({ timeout: Timeout.MEDIUM });

  await options.beforeSubmit?.();

  await expect(
    po.chatActions
      .getHomeChatInputContainer()
      .getByRole("button", { name: "Send message" }),
  ).toBeEnabled({ timeout: Timeout.MEDIUM });

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

async function attachHomeChatContextFile(po: PageObject, filePath: string) {
  await po.chatActions
    .getHomeChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();

  await po.page.getByRole("menuitem", { name: "Attach files" }).click();

  const chatContextItem = po.page.getByText("Attach file as chat context");
  await expect(chatContextItem).toBeVisible({ timeout: Timeout.MEDIUM });

  const fileChooserPromise = po.page.waitForEvent("filechooser");
  await chatContextItem.click();
  const fileChooser = await fileChooserPromise;
  await fileChooser.setFiles(filePath);
  const fileName = filePath.split("/").pop() ?? filePath;
  await expect(po.page.getByText(fileName, { exact: true })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
}

async function readLastServerDump(po: PageObject) {
  const messagesListText = await po.page
    .getByTestId("messages-list")
    .textContent();
  const dumpPathMatches =
    messagesListText?.match(/\[\[dyad-dump-path=([^\]]+)\]\]/g) ?? [];
  expect(dumpPathMatches.length).toBeGreaterThan(0);

  const lastDumpPath = dumpPathMatches[dumpPathMatches.length - 1].match(
    /\[\[dyad-dump-path=([^\]]+)\]\]/,
  )?.[1];
  if (!lastDumpPath) {
    throw new Error("No dump file path found");
  }

  return JSON.parse(fs.readFileSync(lastDumpPath, "utf-8"));
}
