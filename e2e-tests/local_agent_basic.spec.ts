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
  "local-agent - app blueprint approval renames the app",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Imported apps default needs_app_blueprint=0, which gates the
    // write_app_blueprint tool out of the local-agent toolset. Flip it so the
    // fixture's tool call actually executes and sends the IPC update the card
    // needs for approval.
    await po.appManagement.enableAppBlueprintForCurrentApp();

    // Wait for the auto-generated AI_RULES response to finish, then start a
    // clean chat so the fixture flow isn't racing with the import bootstrap chat.
    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/app-blueprint-rename");

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await approveButton.click();

    await expect(async () => {
      expect(await po.appManagement.getCurrentAppName()).toBe("Lumen Notes");
    }).toPass({ timeout: Timeout.MEDIUM });
  },
);

testSkipIfWindows(
  "local-agent - app blueprint template edits are applied",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    await po.appManagement.enableAppBlueprintForCurrentApp();

    await po.chatActions.waitForChatCompletion();
    await po.chatActions.clickNewChat();

    await po.sendPrompt("tc=local-agent/app-blueprint-template-switch");

    const templateSelect = po.page.getByTestId("app-blueprint-template-select");
    await expect(templateSelect).toBeVisible({ timeout: Timeout.MEDIUM });
    await templateSelect.selectOption("next");

    const approveButton = po.page.getByRole("button", { name: "Approve Plan" });
    await expect(approveButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await approveButton.click();

    // Re-fetch the app path after the apply settles: the path-swap branch
    // may relocate the app to a fresh kebab-slug directory.
    await expect(async () => {
      const currentAppPath = await po.appManagement.getCurrentAppPath();
      const packageJson = JSON.parse(
        fs.readFileSync(path.join(currentAppPath, "package.json"), "utf8"),
      );
      expect(
        packageJson.dependencies?.next || packageJson.devDependencies?.next,
      ).toBeTruthy();
    }).toPass({ timeout: Timeout.EXTRA_LONG });
  },
);
