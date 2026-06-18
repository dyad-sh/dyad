import { testSkipIfWindows } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "fs";
import path from "path";

/**
 * E2E test for clearing todos when a turn is cancelled.
 *
 * The fixture creates 2 todos (persisted to disk) and then stalls so the test
 * can cancel mid-stream. On cancellation the handler should:
 * 1. Delete the persisted todos file (.dyad/todos/<chatId>.json)
 * 2. Clear the todo list from the UI
 */
testSkipIfWindows(
  "local-agent - todos cleared on cancellation",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectLocalAgentMode();

    // Fixture creates todos, then stalls so we have time to cancel.
    await po.sendPrompt("tc=local-agent/cancel-todos", {
      skipWaitForCompletion: true,
    });

    // Todo list shows the in-progress task once todos are created/persisted.
    await expect(po.page.getByText("First cancellable task")).toBeVisible();

    // The todos file should now exist on disk.
    const appPath = await po.appManagement.getCurrentAppPath();
    const todosDir = path.join(appPath, ".dyad", "todos");
    expect(fs.existsSync(todosDir) && fs.readdirSync(todosDir).length > 0).toBe(
      true,
    );

    // Cancel the in-flight generation.
    await po.page.getByRole("button", { name: "Cancel generation" }).click();
    await po.chatActions.waitForChatCompletion();

    // UI: the todo list is cleared.
    await expect(po.page.getByText("First cancellable task")).not.toBeVisible();

    // Disk: the persisted todos file is removed.
    const remaining = fs.existsSync(todosDir) ? fs.readdirSync(todosDir) : [];
    expect(remaining).toHaveLength(0);
  },
);
