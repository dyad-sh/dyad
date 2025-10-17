import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("enhance prompt in chat input", async ({ po }) => {
  await po.setUp();

  const chatInput = po.getChatInput();
  const originalPrompt = "make a button";

  // Type a simple prompt
  await chatInput.click();
  await chatInput.fill(originalPrompt);

  // Find and click the enhance button (bolt icon with title "Enhance prompt")
  const enhanceButton = po.page.getByRole("button", {
    name: "Enhance prompt",
  });
  await expect(enhanceButton).toBeVisible();
  await expect(enhanceButton).toBeEnabled();

  // Click the enhance button
  await enhanceButton.click();

  // Wait for the enhancement to complete (button should show spinner then return to normal)
  await expect(enhanceButton).toBeEnabled({ timeout: 5000 });

  // Verify the input now contains enhanced text
  const enhancedText = await chatInput.inputValue();
  expect(enhancedText).not.toBe(originalPrompt);
  expect(enhancedText).toContain("comprehensive");
  expect(enhancedText).toContain("detailed");
  expect(enhancedText).toContain(originalPrompt);
});

test("enhance prompt in home input", async ({ po }) => {
  // Start at home page (don't create an app)
  await po.openApp();
  await po.clickSkipSetup();

  const homeInput = po.page.locator(
    '[data-testid="home-chat-input-container"] [data-lexical-editor="true"]',
  );
  const originalPrompt = "create a calculator app";

  // Type a simple prompt
  await homeInput.click();
  await homeInput.fill(originalPrompt);

  // Find and click the enhance button in home input
  const enhanceButton = po
    .getHomeChatInputContainer()
    .getByRole("button", { name: "Enhance prompt" });
  await expect(enhanceButton).toBeVisible();
  await expect(enhanceButton).toBeEnabled();

  // Click the enhance button
  await enhanceButton.click();

  // Wait for the enhancement to complete
  await expect(enhanceButton).toBeEnabled({ timeout: 5000 });

  // Verify the input now contains enhanced text
  const enhancedText = await homeInput.inputValue();
  expect(enhancedText).not.toBe(originalPrompt);
  expect(enhancedText).toContain("comprehensive");
  expect(enhancedText).toContain("detailed");
  expect(enhancedText).toContain(originalPrompt);
});

test("enhance button disabled when input is empty", async ({ po }) => {
  await po.setUp();

  const chatInput = po.getChatInput();

  // Ensure input is empty
  await chatInput.click();
  await chatInput.fill("");

  // Enhance button should be disabled
  const enhanceButton = po.page.getByRole("button", {
    name: "Enhance prompt",
  });
  await expect(enhanceButton).toBeVisible();
  await expect(enhanceButton).toBeDisabled();
});

test("enhance button disabled during streaming", async ({ po }) => {
  await po.setUp();

  const chatInput = po.getChatInput();

  // Type and send a message to start streaming
  await chatInput.click();
  await chatInput.fill("test prompt [sleep=medium]");
  await po.page.getByRole("button", { name: "Send message" }).click();

  // While streaming, type something in the input
  await chatInput.click();
  await chatInput.fill("another prompt");

  // Enhance button should be disabled during streaming
  const enhanceButton = po.page.getByRole("button", {
    name: "Enhance prompt",
  });
  await expect(enhanceButton).toBeDisabled();
});
