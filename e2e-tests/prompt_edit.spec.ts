import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("edit first prompt creates a new chat with edited content only", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.sendPrompt("tc=chat1");

  await po.page.locator("button:has(.lucide-pencil)").first().click();
  // Wait for the textarea to be visible before trying to fill it
  const editTextarea = po.page.getByTestId("chat-message-edit-textarea");
  await editTextarea.waitFor({ state: "visible" });
  await editTextarea.fill("Update your prompt...");
  await po.page.getByRole("button", { name: "Save" }).click();

  await po.waitForChatCompletion();

  await expect(po.page.getByText("tc=chat1")).toHaveCount(0);
  await expect(po.page.getByText("Update your prompt...")).toBeVisible();
});

test("editing a later prompt copies only previous history into the new chat", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.sendPrompt("tc=chat1");
  await po.sendPrompt("tc=chat2");
  await po.sendPrompt("tc=chat3");
  await po.page.locator("button:has(.lucide-pencil)").nth(2).click();
  // Wait for the textarea to be visible before trying to fill it
  const editTextarea = po.page.getByTestId("chat-message-edit-textarea");
  await editTextarea.waitFor({ state: "visible" });
  await editTextarea.fill("Update your prompt...");
  await po.page.getByRole("button", { name: "Save" }).click();

  await po.waitForChatCompletion();
  // Check that the new chat has only the first prompt's content
  await expect(po.page.getByText("tc=chat1")).toHaveCount(1);
  await expect(po.page.getByText("tc=chat2")).toHaveCount(0);
  await expect(po.page.getByText("Update your prompt...")).toBeVisible();
});
