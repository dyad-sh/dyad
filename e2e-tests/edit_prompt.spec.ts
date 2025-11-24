import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";
import type { PageObject } from "./helpers/test_helper";

async function editFirstPrompt(po: PageObject, newContent: string) {
  // Find the edit button with Pencil icon within chat messages
  // The button contains a Pencil icon (lucide-react's Pencil component)
  const editButton = po.page.locator("button:has(.lucide-pencil)").first();
  await editButton.click();

  // Wait for the textarea to be visible before trying to fill it
  const editTextarea = po.page.getByTestId("chat-message-edit-textarea");
  await editTextarea.waitFor({ state: "visible" });
  await editTextarea.fill(newContent);

  await po.page.getByRole("button", { name: "Save" }).click();
  await po.waitForChatCompletion();
}

test("editing earliest prompt hides downstream prompts until switching versions", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  await po.sendPrompt("Prompt 1 - original");
  await po.sendPrompt("Prompt 2 - follow-up");
  await po.sendPrompt("Prompt 3 - final context");

  await expect(
    po.page.getByText("Prompt 2 - follow-up", { exact: true }),
  ).toBeVisible();
  await expect(
    po.page.getByText("Prompt 3 - final context", { exact: true }),
  ).toBeVisible();

  await editFirstPrompt(po, "Prompt 1 - edited branch");

  await expect(po.page.getByText("2/2", { exact: true })).toBeVisible();

  await expect(
    po.page.getByText("Prompt 2 - follow-up", { exact: true }),
  ).toHaveCount(0);
  await expect(
    po.page.getByText("Prompt 3 - final context", { exact: true }),
  ).toHaveCount(0);

  await po.page.getByRole("button", { name: "Previous version" }).click();

  await expect(po.page.getByText("1/2", { exact: true })).toBeVisible();
  await expect(
    po.page.getByText("Prompt 2 - follow-up", { exact: true }),
  ).toBeVisible();
  await expect(
    po.page.getByText("Prompt 3 - final context", { exact: true }),
  ).toBeVisible();
});

test("editing from older version hides newer branch prompts", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });

  await po.sendPrompt("Prompt 1 - original base");
  await po.sendPrompt("Prompt 2 - base follow-up");

  await editFirstPrompt(po, "Prompt 1 - branch version 2");

  await po.sendPrompt("Prompt 4 - branch only follow-up");
  await expect(
    po.page.getByText("Prompt 4 - branch only follow-up", { exact: true }),
  ).toBeVisible();

  await po.page.getByRole("button", { name: "Previous version" }).click();
  await expect(po.page.getByText("1/2", { exact: true })).toBeVisible();
  await expect(
    po.page.getByText("Prompt 4 - branch only follow-up", { exact: true }),
  ).toHaveCount(0);
  await expect(
    po.page.getByText("Prompt 2 - base follow-up", { exact: true }),
  ).toBeVisible();

  await editFirstPrompt(po, "Prompt 1 - branch version 3");

  await expect(po.page.getByText("1/3", { exact: true })).toBeVisible();
  await expect(
    po.page.getByText("Prompt 4 - branch only follow-up", { exact: true }),
  ).toHaveCount(0);

  await po.page.getByRole("button", { name: "Next version" }).click();
  await expect(po.page.getByText("2/3", { exact: true })).toBeVisible();
  await expect(
    po.page.getByText("Prompt 4 - branch only follow-up", { exact: true }),
  ).toBeVisible();
});
