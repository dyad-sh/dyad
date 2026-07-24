import {
  testWithConfig,
  Timeout,
  type PageObject,
} from "./helpers/test_helper";
import { expect, type Locator } from "@playwright/test";
import type { ElectronApplication } from "playwright";
import * as fs from "fs";

const testSetup = testWithConfig({
  showSetupScreen: true,
});

testSetup.describe("Setup Flow", () => {
  testSetup("setup dialog shows AI provider options", async ({ po }) => {
    const dialog = await openAiSetupDialog(po);

    await expect(
      dialog.getByText("Your prompt is saved — it'll send as soon as"),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: /Start free Dyad Pro trial/ }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Google" })).toBeVisible();
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

    await dialog.getByRole("button", { name: "Google" }).click();
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

      await setupGoogleKeyAndExpectResume(po, dialog, prompt);
    },
  );

  testSetup(
    "Enter-key submit resumes the pending first prompt after Google API key setup",
    async ({ po }) => {
      await seedFakeModelSelection(po);
      const prompt = "Build a tiny recipe box";

      // Submit with the Enter key instead of the send button: the Enter path
      // goes through EnterKeyPlugin, which once cleared the editor even when
      // the submit was rejected and queued as a pending first prompt.
      const dialog = await openAiSetupDialog(po, prompt, { submit: "enter" });

      // The queued prompt must survive while the user configures a provider;
      // if it's wiped here, the auto-resume effect on the home page has
      // nothing to submit and silently arms itself on the next keystroke.
      await expect(po.chatActions.getChatInput()).toContainText(prompt, {
        timeout: Timeout.MEDIUM,
      });

      await setupGoogleKeyAndExpectResume(po, dialog, prompt);
    },
  );

  testSetup(
    "OpenRouter API key setup switches the pending first prompt from Build to Basic Agent",
    async ({ po }) => {
      await seedFakeModelSelection(po);
      await expectInitialBuildMode(po);
      const prompt = "Build a tiny meal planner";
      const dialog = await openAiSetupDialog(po, prompt);
      await restoreLocalAgentDefault(po);

      await dialog.getByRole("button", { name: "OpenRouter" }).click();
      await expect(
        po.page.getByRole("heading", { name: "Configure OpenRouter" }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await po.page
        .getByPlaceholder(/Enter new OpenRouter API Key here/)
        .fill("test-openrouter-key-12345");
      await po.page.getByRole("button", { name: "Save Key" }).click();
      await expectProviderApiKeySaved(
        po,
        "openrouter",
        "test-openrouter-key-12345",
      );

      await expect(
        po.page.getByTestId("messages-list").getByText(prompt),
      ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
      await po.chatActions.waitForChatCompletion({
        timeout: Timeout.EXTRA_LONG,
      });
      await expect(po.page.getByRole("dialog")).not.toBeVisible();
      await expectSelectedApp(po);
      await expectLocalAgentMode(po, "Basic Agent");
    },
  );

  testSetup(
    "Google clipboard paste and save persists the key and resumes the pending first prompt",
    async ({ po }) => {
      await seedFakeModelSelection(po);
      const prompt = "Build a tiny reading list";
      const apiKey = "test-google-clipboard-key-12345";
      const dialog = await openAiSetupDialog(po, prompt);

      await dialog.getByRole("button", { name: "Google" }).click();
      await expect(
        po.page.getByRole("heading", { name: "Configure Google" }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await po.page
        .context()
        .grantPermissions(["clipboard-read", "clipboard-write"]);
      await po.page.evaluate(
        (key) => navigator.clipboard.writeText(key),
        apiKey,
      );
      await po.page.getByRole("button", { name: "Paste & Save" }).click();
      await expectProviderApiKeySaved(po, "google", apiKey);

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
    "invalid Google API key can be retried without saving or resuming",
    async ({ po }) => {
      await seedFakeModelSelection(po);
      const prompt = "Build a tiny focus timer";
      const dialog = await openAiSetupDialog(po, prompt);

      await dialog.getByRole("button", { name: "Google" }).click();
      await expect(
        po.page.getByRole("heading", { name: "Configure Google" }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await po.page
        .getByPlaceholder(/Enter new Google API Key here/)
        .fill("invalid-google-key");
      await po.page.getByRole("button", { name: "Save Key" }).click();

      const validationDialog = po.page.getByRole("alertdialog");
      await expect(
        validationDialog.getByRole("heading", {
          name: "API key rejected",
        }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });
      await validationDialog
        .getByRole("button", { name: "Try another API key" })
        .click();
      await expect(validationDialog).toBeHidden({
        timeout: Timeout.MEDIUM,
      });

      const settingsAfterRetry = po.settings.recordSettings() as {
        providerSettings?: Record<string, unknown>;
      };
      expect(settingsAfterRetry.providerSettings?.google).toBe(undefined);
      await expect(
        po.page.getByRole("heading", { name: "Configure Google" }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });

      await po.page.getByRole("button", { name: "Test Key" }).click();
      await expect(
        validationDialog.getByRole("heading", {
          name: "API key rejected",
        }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });
      await expect(
        validationDialog.getByRole("button", { name: "Keep invalid API key" }),
      ).toBeHidden();
      await validationDialog
        .getByRole("button", { name: "Try another API key" })
        .click();
      await expect(validationDialog).toBeHidden({
        timeout: Timeout.MEDIUM,
      });

      await po.page.getByRole("button", { name: "Save Key" }).click();
      await expect(
        validationDialog.getByRole("heading", {
          name: "API key rejected",
        }),
      ).toBeVisible({ timeout: Timeout.MEDIUM });
      await validationDialog
        .getByRole("button", { name: "Keep invalid API key" })
        .click();

      await expect(
        po.page.getByTestId("messages-list").getByText(prompt),
      ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
      await po.chatActions.waitForChatCompletion({
        timeout: Timeout.EXTRA_LONG,
      });
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

      await dialog.getByRole("button", { name: "Google" }).click();
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
    "Dyad Pro return deep link switches the pending first prompt from Build to Agent",
    async ({ po, electronApp }) => {
      await expectInitialBuildMode(po);
      const prompt = "Build a tiny workout planner";
      await openAiSetupDialog(po, prompt);
      await restoreLocalAgentDefault(po);

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
      await expectLocalAgentMode(po, "Agent");
    },
  );
});

async function expectInitialBuildMode(po: PageObject) {
  await po.pinBuildChatModeForSetup();
  await po.navigation.goToAppsTab();
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    "Build",
    { timeout: Timeout.MEDIUM },
  );
}

async function restoreLocalAgentDefault(po: PageObject) {
  await po.page.evaluate(async () => {
    await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
      defaultChatMode: "local-agent",
    });
  });
  await expect
    .poll(() => po.settings.recordSettings().defaultChatMode, {
      timeout: Timeout.MEDIUM,
    })
    .toBe("local-agent");
}

async function expectLocalAgentMode(
  po: PageObject,
  expectedDisplayName: "Basic Agent" | "Agent",
) {
  await expect(po.page.getByTestId("chat-mode-selector")).toContainText(
    expectedDisplayName,
    { timeout: Timeout.MEDIUM },
  );
  await expect
    .poll(() => po.settings.recordSettings().selectedChatMode, {
      timeout: Timeout.MEDIUM,
    })
    .toBe("local-agent");
}

async function setupGoogleKeyAndExpectResume(
  po: PageObject,
  dialog: Locator,
  prompt: string,
) {
  await dialog.getByRole("button", { name: "Google" }).click();
  await expect(
    po.page.getByRole("heading", { name: "Configure Google" }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });

  await po.page
    .getByPlaceholder(/Enter new Google API Key here/)
    .fill("test-google-key-12345");
  await po.page.getByRole("button", { name: "Save Key" }).click();
  await expectProviderApiKeySaved(po, "google", "test-google-key-12345");

  await expect(
    po.page.getByTestId("messages-list").getByText(prompt),
  ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
  await po.chatActions.waitForChatCompletion({
    timeout: Timeout.EXTRA_LONG,
  });
  await expect(po.page.getByRole("dialog")).not.toBeVisible();
  await expectSelectedApp(po);
}

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

async function expectProviderApiKeySaved(
  po: PageObject,
  provider: string,
  expectedApiKey: string,
) {
  await expect
    .poll(
      async () => {
        const settings = await po.page.evaluate(async () => {
          const ipcRenderer = (window as any).electron.ipcRenderer;
          return ipcRenderer.invoke("get-user-settings");
        });
        return settings.providerSettings?.[provider]?.apiKey?.value;
      },
      { timeout: Timeout.MEDIUM },
    )
    .toBe(expectedApiKey);
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
  options: {
    beforeSubmit?: () => Promise<void>;
    // Enter and the send button are distinct code paths (EnterKeyPlugin vs
    // the button's click handler — see rules/e2e-testing.md).
    submit?: "button" | "enter";
  } = {},
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

  if (options.submit === "enter") {
    await chatInput.press("Enter");
  } else {
    await po.chatActions
      .getHomeChatInputContainer()
      .getByRole("button", { name: "Send message" })
      .click();
  }

  const dialog = po.page.getByRole("dialog");
  await expect(
    dialog.getByText("Your prompt is saved — it'll send as soon as"),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
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
