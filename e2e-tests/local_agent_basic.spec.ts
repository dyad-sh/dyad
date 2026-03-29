import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * E2E tests for local-agent mode (Agent v2)
 * Tests multi-turn tool call conversations using the TypeScript DSL fixtures
 */

testSkipIfWindows("local-agent - dump request", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("[dump]");

  await po.snapshotServerDump("request");
  await po.snapshotServerDump("all-messages");
});

testSkipIfWindows("local-agent - read then edit", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/read-then-edit");
  await po.snapshotMessages();
  await po.snapshotAppFiles({
    name: "after-edit",
    files: ["src/App.tsx"],
  });
});

testSkipIfWindows("local-agent - parallel tool calls", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  await po.sendPrompt("tc=local-agent/parallel-tools");

  await po.snapshotMessages();
  await po.snapshotAppFiles({
    name: "after-parallel",
    files: ["src/utils/math.ts", "src/utils/string.ts"],
  });
});

testSkipIfWindows("local-agent - questionnaire flow", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();

  // Wait for the auto-generated AI_RULES response to fully complete,
  // then start a new chat to avoid the chat:stream:end event from the
  // AI_RULES stream clearing the questionnaire state.
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.clickNewChat();

  // Trigger questionnaire fixture
  await po.sendPrompt("tc=local-agent/questionnaire", {
    skipWaitForCompletion: true,
  });

  // Wait for questionnaire UI to appear
  await expect(po.page.getByText("Which framework do you prefer?")).toBeVisible(
    {
      timeout: Timeout.MEDIUM,
    },
  );

  await expect(po.page.getByRole("button", { name: "Submit" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Select "Vue" radio option
  await po.page.getByText("Vue", { exact: true }).click();

  // Submit the questionnaire
  await po.page.getByRole("button", { name: /Submit/ }).click();

  // Wait for the LLM response after submitting answers
  await po.chatActions.waitForChatCompletion();

  // Snapshot the messages
  await po.snapshotMessages();
});

testSkipIfWindows(
  "local-agent - mini plan approval renames the app",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Wait for the auto-generated AI_RULES response to finish, then start a
    // clean chat so the fixture flow isn't racing with the import bootstrap chat.
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/mini-plan-rename");

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await approveButton.click();

    await expect(async () => {
      expect(await po.appManagement.getCurrentAppName()).toBe("Lumen Notes");
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);

testSkipIfWindows(
  "local-agent - mini plan approve button waits for streaming to finish",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/mini-plan-template-switch", {
      skipWaitForCompletion: true,
    });

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(approveButton).toBeDisabled();

    await po.chatActions.waitForChatCompletion();
    await expect(approveButton).toBeEnabled();
  },
);

testSkipIfWindows(
  "local-agent - mini plan template edits are applied",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    const appPath = await po.appManagement.getCurrentAppPath();

    await po.sendPrompt("tc=local-agent/mini-plan-template-switch");

    const templateSelect = po.page.getByTestId("mini-plan-template-select");
    await expect(templateSelect).toBeVisible({ timeout: Timeout.MEDIUM });
    await templateSelect.selectOption("next");

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await approveButton.click();

    await expect(async () => {
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(appPath, "package.json"), "utf8"),
      );
      expect(
        packageJson.dependencies?.next || packageJson.devDependencies?.next,
      ).toBeTruthy();
    }).toPass({ timeout: Timeout.EXTRA_LONG });
  },
);

testSkipIfWindows(
  "local-agent - mini plan shows custom themes",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.chatActions.waitForChatCompletion();

    await po.chatActions
      .getChatInputContainer()
      .getByTestId("auxiliary-actions-menu")
      .click();
    await po.page.getByRole("menuitem", { name: "Themes" }).click();
    await po.page.getByRole("menuitem", { name: "New Theme" }).click();

    await expect(
      po.page.getByRole("dialog").getByText("Create Custom Theme"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    await po.page.getByRole("tab", { name: "Manual Configuration" }).click();
    await po.page.locator("#manual-name").fill("Mini Plan Theme");
    await po.page.locator("#manual-description").fill("Available in mini plan");
    await po.page
      .locator("#manual-prompt")
      .fill("Use warm neutrals and editorial spacing");
    await po.page.getByRole("button", { name: "Save Theme" }).click();

    await expect(po.page.getByRole("dialog")).not.toBeVisible();

    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/mini-plan-template-switch");

    const themeSelect = po.page.getByTestId("mini-plan-theme-select");
    await expect(themeSelect).toBeVisible({ timeout: Timeout.MEDIUM });

    const themeOptions = await themeSelect
      .locator("option")
      .evaluateAll((options) =>
        options.map((option) => ({
          value: (option as HTMLOptionElement).value,
          label: option.textContent?.trim() ?? "",
        })),
      );

    expect(themeOptions).toContainEqual({
      value: "default",
      label: "Default Theme",
    });

    const customThemeValue = themeOptions.find(
      (option) => option.label === "Mini Plan Theme",
    )?.value;
    expect(customThemeValue).toMatch(/^custom:\d+$/);

    await themeSelect.selectOption(customThemeValue!);
    await expect(themeSelect).toHaveValue(customThemeValue!);
  },
);
