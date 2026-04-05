import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

/**
 * E2E tests for generating an image from the chat via the auxiliary actions menu.
 * This tests the flow: + menu → Generate Image → fill prompt → Generate → image appears in strip → send auto-adds to chat.
 */

test("generate image from chat - full flow", async ({ po }) => {
  await po.setUpDyadPro();
  await po.importApp("minimal");

  // Approve the code proposal from the import so the send button is unblocked
  await po.approveProposal();

  // Open auxiliary actions menu in the chat input
  await po.chatActions
    .getChatInputContainer()
    .getByTestId("auxiliary-actions-menu")
    .click();

  // Click "Generate Image" menu item
  const generateImageItem = po.page.getByTestId("generate-image-menu-item");
  await expect(generateImageItem).toBeVisible();
  await generateImageItem.click();

  // The Image Generator dialog should be open
  const dialog = po.page.getByRole("dialog");
  await expect(dialog).toBeVisible();

  // Fill in the prompt
  const promptTextarea = dialog.getByPlaceholder(
    "Describe the image you want to create...",
  );
  await expect(promptTextarea).toBeVisible();
  await promptTextarea.fill("A beautiful sunset over mountains");

  // Click Generate (app is auto-selected since there's only one)
  const generateButton = dialog.getByRole("button", { name: "Generate" });
  await expect(generateButton).toBeEnabled();
  await generateButton.click();

  // Dialog should close after clicking Generate
  await expect(dialog).not.toBeVisible();

  // Wait for the generated image to appear in the strip (thumbnail appears on success)
  const imageStrip = po.chatActions.getChatInputContainer();
  const generatedImage = imageStrip.locator(
    "img[alt='A beautiful sunset over mountains']",
  );
  await expect(generatedImage).toBeVisible({ timeout: Timeout.LONG });

  // The send button should be enabled even without text input
  const sendButton = po.page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeEnabled();

  // Click send - images are automatically added to the message
  await sendButton.click();

  // The image strip entry should be dismissed after sending
  await expect(generatedImage).not.toBeVisible();

  // Verify the sent message contains the generated image (rendered as an image element)
  const messagesList = po.page.locator('[data-testid="messages-list"]');
  await expect(
    messagesList.locator("img[alt*='generated_a_beautiful_sunset']"),
  ).toBeVisible({ timeout: Timeout.LONG });
});
