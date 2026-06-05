import { testSkipIfWindows, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

/**
 * E2E test for the per-message "restore" arrow on user messages.
 *
 * Clicking the arrow on a user message should:
 *  1. Create a NEW chat containing only the messages before that message
 *     (the original chat stays intact).
 *  2. Restore the app's code to the version that existed right before that
 *     message was sent.
 *  3. Navigate the user to the new chat.
 */
testSkipIfWindows(
  "restore to message - forks chat and reverts code",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    const indexPath = async () =>
      path.join(
        await po.appManagement.getCurrentAppPath(),
        "src",
        "pages",
        "Index.tsx",
      );

    // Turn A: writes src/pages/Index.tsx -> creates a version.
    await po.sendPrompt("tc=write-index");
    expect(fs.readFileSync(await indexPath(), "utf-8")).toContain(
      "Testing:write-index!",
    );

    // Turn B: overwrites src/pages/Index.tsx -> creates a newer version.
    await po.sendPrompt("tc=write-index-2");
    expect(fs.readFileSync(await indexPath(), "utf-8")).toContain(
      "Testing:write-index(2)!",
    );

    const originalChatId = po.page.url().match(/[?&]id=(\d+)/)?.[1];
    expect(originalChatId).toBeTruthy();

    // The original chat has two user messages, so two restore buttons.
    const restoreButtons = po.page.getByTestId("restore-to-message-button");
    await expect(restoreButtons).toHaveCount(2);

    // Click the undo icon on the SECOND user message (turn B), then confirm in
    // the dialog. This should create a new chat with [userA, assistantA] and
    // revert the app to the state after turn A (i.e. before turn B).
    await restoreButtons.nth(1).click();
    await po.page.getByTestId("confirm-restore-to-message-button").click();

    // We should navigate to a brand-new chat.
    await expect(async () => {
      const newChatId = po.page.url().match(/[?&]id=(\d+)/)?.[1];
      expect(newChatId).toBeTruthy();
      expect(newChatId).not.toBe(originalChatId);
    }).toPass({ timeout: Timeout.LONG });

    // The new chat contains only the messages before turn B: exactly one user
    // message (turn A), hence one restore button.
    await expect(restoreButtons).toHaveCount(1);

    const messagesList = po.page.getByTestId("messages-list");
    await expect(messagesList).toContainText("tc=write-index");
    await expect(messagesList).not.toContainText("tc=write-index-2");

    // The app code is reverted to the state right before turn B.
    await expect(async () => {
      const content = fs.readFileSync(await indexPath(), "utf-8");
      expect(content).toContain("Testing:write-index!");
      expect(content).not.toContain("Testing:write-index(2)!");
    }).toPass({ timeout: Timeout.LONG });
  },
);
