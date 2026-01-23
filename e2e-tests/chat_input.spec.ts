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
