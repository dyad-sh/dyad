import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";
import { expandFileTreeToPath } from "./helpers/monaco_editor";

test("mention file", async ({ po }) => {
  await po.setUp({ autoApprove: true });

  await po.importApp("minimal-with-ai-rules");
  await po.navigation.goToAppsTab();
  await po.chatActions.getChatInput().click();
  // Use pressSequentially so the mention trigger (@) is properly detected by Lexical
  await po.chatActions.getChatInput().pressSequentially("[dump] @AI_RULES");
  // Wait for the mention menu to appear
  const menuItem = po.page.getByRole("menuitem", {
    name: "Choose AI_RULES.md",
  });
  await expect(menuItem).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page.keyboard.press("Enter");
  await po.page.getByRole("button", { name: "Send message" }).click();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
});

test("reference file from editor file tree", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.navigation.goToChatTab();
  await po.previewPanel.selectPreviewMode("code");

  // Wait for the file tree to finish loading
  await expect(
    po.page.getByText("Loading files...", { exact: false }),
  ).toBeHidden({
    timeout: Timeout.LONG,
  });

  // Type [dump] into chat input first, before clicking the mention button.
  // This avoids Lexical's ExternalValueSyncPlugin overwriting typed text when the atom updates.
  const chatInput = po.chatActions.getChatInput();
  await chatInput.click();
  await chatInput.pressSequentially("[dump]");

  // Wait for the atom to sync with the typed text
  await expect(async () => {
    const text = await chatInput.textContent();
    expect(text).toContain("[dump]");
  }).toPass({ timeout: Timeout.SHORT });

  await expandFileTreeToPath(po.page, "src/App.tsx");

  // Find the file row containing "App.tsx" and its mention button.
  const appTsxText = po.page
    .locator(".file-tree")
    .getByText("App.tsx", { exact: true })
    .first();
  await expect(appTsxText).toBeVisible({ timeout: Timeout.MEDIUM });

  // Walk up to the row itself and hover to reveal the mention button. The name
  // shares a wrapper span with its change marker, so the immediate parent is
  // that wrapper rather than the row the button lives in.
  const fileRow = appTsxText.locator(
    'xpath=ancestor::div[@data-testid="file-tree-file"][1]',
  );
  await fileRow.hover();

  // Click the "Mention file in chat" button within this specific row
  const mentionButton = fileRow.getByRole("button", {
    name: "Mention file in chat",
  });
  await expect(mentionButton).toBeVisible({ timeout: Timeout.SHORT });
  await mentionButton.click();

  // Verify the file reference was appended to the chat input
  await expect(async () => {
    const text = await chatInput.textContent();
    expect(text).toContain("[dump]");
    expect(text).toContain("App.tsx");
  }).toPass({ timeout: Timeout.SHORT });

  // Send the message and verify the server receives the file reference
  await po.page.getByRole("button", { name: "Send message" }).click();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("all-messages");
});
