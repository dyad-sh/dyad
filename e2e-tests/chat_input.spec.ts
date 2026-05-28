import { test, Timeout } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("send button disabled during pending proposal", async ({ po }) => {
  await po.setUp();

  // Send a prompt that generates a proposal
  await po.sendPrompt("Create a simple React component");

  // Wait for proposal buttons to appear (ensuring proposal is rendered)
  await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Type something in the input to ensure it's not disabled due to empty input.
  // Use click + keyboard.type instead of fill() for Lexical editor reliability.
  const chatInput = po.chatActions.getChatInput();
  await chatInput.click();
  await po.page.keyboard.type("test message");

  // Check send button is disabled due to pending changes
  const sendButton = po.page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeDisabled();

  // Approve the proposal
  await po.approveProposal();

  // Check send button is enabled again
  await expect(sendButton).toBeEnabled({ timeout: Timeout.MEDIUM });
});

test("send button disabled during pending proposal - reject", async ({
  po,
}) => {
  await po.setUp();

  // Send a prompt that generates a proposal
  await po.sendPrompt("Create a simple React component");

  // Wait for proposal buttons to appear (ensuring proposal is rendered)
  await expect(po.page.getByTestId("reject-proposal-button")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Type something in the input to ensure it's not disabled due to empty input.
  // Use click + keyboard.type instead of fill() for Lexical editor reliability.
  const chatInput = po.chatActions.getChatInput();
  await chatInput.click();
  await po.page.keyboard.type("test message");

  // Check send button is disabled due to pending changes
  const sendButton = po.page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeDisabled();

  // Reject the proposal
  await po.rejectProposal();

  // Check send button is enabled again
  await expect(sendButton).toBeEnabled({ timeout: Timeout.MEDIUM });
});
