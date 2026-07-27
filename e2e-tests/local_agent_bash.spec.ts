import fs from "node:fs/promises";
import path from "node:path";
import { expect } from "@playwright/test";
import {
  type PageObject,
  Timeout,
  testSkipIfWindows,
} from "./helpers/test_helper";
import { BASH_WRITE_INDEX_COMMAND } from "./fixtures/agent/bash-write-index";

async function openMinimalChat(po: PageObject) {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.chatActions.waitForChatCompletion();
  await po.chatActions.clickNewChat();
}

testSkipIfWindows(
  "agent mode - Bash requires consent and refreshes the preview",
  async ({ po }) => {
    await openMinimalChat(po);
    await po.chatActions.selectLocalAgentMode();
    const appPath = await po.appManagement.getCurrentAppPath();

    await po.sendPrompt("tc=local-agent/bash-write-index", {
      skipWaitForCompletion: true,
    });

    await expect(
      po.chatActions
        .getChatInputContainer()
        .getByText(BASH_WRITE_INDEX_COMMAND, { exact: true }),
    ).toBeVisible({ timeout: Timeout.LONG });
    await expect(
      po.page.getByRole("button", { name: "Always allow" }),
    ).toBeHidden();
    await po.page.getByRole("button", { name: "Allow once" }).click();
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.EXTRA_LONG });

    await expect(async () => {
      const source = await fs.readFile(
        path.join(appPath, "src/App.tsx"),
        "utf8",
      );
      expect(source).toContain("Created by Bash Tool");
    }).toPass({ timeout: Timeout.LONG });

    const iframe = po.previewPanel.getPreviewIframeElement();
    await expect(
      iframe.contentFrame().getByText("Created by Bash Tool"),
    ).toBeVisible({ timeout: Timeout.EXTRA_LONG });
  },
);

testSkipIfWindows(
  "ask mode - a requested Bash write cannot change the app",
  async ({ po }) => {
    await openMinimalChat(po);
    await po.chatActions.selectChatMode("ask");
    const appPath = await po.appManagement.getCurrentAppPath();
    const indexPath = path.join(appPath, "src/App.tsx");
    const originalSource = await fs.readFile(indexPath, "utf8");

    await po.sendPrompt("tc=local-agent/bash-write-index", {
      timeout: Timeout.LONG,
    });

    await expect(
      po.page.getByRole("button", { name: "Allow once" }),
    ).toBeHidden();
    await expect(fs.readFile(indexPath, "utf8")).resolves.toBe(originalSource);
  },
);
