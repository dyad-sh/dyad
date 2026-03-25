import { expect } from "@playwright/test";
import { test, Timeout } from "./helpers/test_helper";

/**
 * E2E tests for generating an image from the chat via the auxiliary actions menu.
 * This tests the flow: + menu → Generate Image → fill prompt → Generate → image appears in strip → Add to chat.
 */

test("generate image from chat - full flow", async ({ po }) => {
  await po.setUpDyadPro();
  await po.importApp("minimal");

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

  // Wait for the generated image to appear in the strip (the "Add to chat" button appears on success)
  const addToChatButton = po.page.getByRole("button", {
    name: "Add to chat",
  });
  await expect(addToChatButton).toBeVisible({ timeout: Timeout.LONG });

  // Click "Add to chat" to insert the @media mention into the chat input
  await addToChatButton.click();

  // The image strip entry should be dismissed after adding to chat
  await expect(addToChatButton).not.toBeVisible();

  // Verify the chat input contains the generated image file name
  const chatInput = po.chatActions.getChatInput();
  const inputText = await chatInput.textContent();
  expect(inputText).toMatch(/generated_a_beautiful_sunset/);
});
