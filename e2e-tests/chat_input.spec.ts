import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("send button disabled during pending proposal", async ({ po }) => {
  await po.setUp();

  // Send a prompt that generates a proposal
  await po.sendPrompt("Create a simple React component");

  // Wait for proposal buttons to appear (ensuring proposal is rendered)
  await expect(po.page.getByTestId("approve-proposal-button")).toBeVisible();

  // Type something in the input to ensure it's not disabled due to empty input
  await po.getChatInput().fill("test message");

  // Check send button is disabled due to pending changes
  const sendButton = po.page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeDisabled();

  // Approve the proposal
  await po.approveProposal();

  // Check send button is enabled again
  await expect(sendButton).toBeEnabled();
});

test("send button disabled during pending proposal - reject", async ({
  po,
}) => {
  await po.setUp();

  // Send a prompt that generates a proposal
  await po.sendPrompt("Create a simple React component");

  // Wait for proposal buttons to appear (ensuring proposal is rendered)
  await expect(po.page.getByTestId("reject-proposal-button")).toBeVisible();

  // Type something in the input to ensure it's not disabled due to empty input
  await po.getChatInput().fill("test message");

  // Check send button is disabled due to pending changes
  const sendButton = po.page.getByRole("button", { name: "Send message" });
  await expect(sendButton).toBeDisabled();

  // Reject the proposal
  await po.rejectProposal();

  // Check send button is enabled again
  await expect(sendButton).toBeEnabled();
});

test("chat input history navigation - up arrow recalls previous prompts", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.getChatInput();

  // Send multiple prompts to create history
  await po.sendPrompt("First message");
  await po.sendPrompt("Second message");
  await po.sendPrompt("Third message");

  // Clear the input (should be empty after sending)
  await chatInput.click();
  await chatInput.fill("");
  await expect(chatInput).toBeEmpty(); // Wait for input to clear

  // Press Up arrow to get the most recent message (Third message)
  await chatInput.press("ArrowUp");
  await expect(chatInput).toHaveText("Third message");

  // Press Up arrow again to get the second message
  await chatInput.press("ArrowUp");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Second message");

  // Press Up arrow again to get the first message
  await chatInput.press("ArrowUp");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("First message");

  // Press Down arrow to go back to second message
  await chatInput.press("ArrowDown");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Second message");

  // Press Down arrow again to go back to third message
  await chatInput.press("ArrowDown");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Third message");

  // Press Down arrow again to go back to empty (draft)
  await chatInput.press("ArrowDown");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("");
});

test("chat input history navigation - only works when input is empty", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.getChatInput();

  // Send a message to create history
  await po.sendPrompt("Previous message");

  // Type something in the input (not empty)
  await chatInput.click();
  await chatInput.fill("Currently typing");
  await po.page.waitForTimeout(100);

  // Press Up arrow - should NOT navigate (input is not empty)
  await chatInput.press("ArrowUp");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Currently typing");

  // Clear input and try again
  await chatInput.fill("");
  await po.page.waitForTimeout(100);
  await chatInput.press("ArrowUp");
  await po.page.waitForTimeout(100);
  // Now it should work since input is empty
  expect(await chatInput.textContent()).toBe("Previous message");
});

test("chat input history navigation - works with multiple messages", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  const chatInput = po.getChatInput();

  // Send 5 messages
  await po.sendPrompt("Message 1");
  await po.sendPrompt("Message 2");
  await po.sendPrompt("Message 3");
  await po.sendPrompt("Message 4");
  await po.sendPrompt("Message 5");

  // Clear input and navigate through all messages
  await chatInput.click();
  await chatInput.fill("");
  await po.page.waitForTimeout(100);

  // Navigate backwards through all messages
  await chatInput.press("ArrowUp"); // Message 5
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Message 5");

  await chatInput.press("ArrowUp"); // Message 4
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Message 4");

  await chatInput.press("ArrowUp"); // Message 3
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Message 3");

  await chatInput.press("ArrowUp"); // Message 2
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Message 2");

  await chatInput.press("ArrowUp"); // Message 1
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Message 1");

  // Can't go further back
  await chatInput.press("ArrowUp");
  await po.page.waitForTimeout(100);
  expect(await chatInput.textContent()).toBe("Message 1");
});
