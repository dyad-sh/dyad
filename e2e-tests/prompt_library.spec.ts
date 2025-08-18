import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("create and edit prompt", async ({ po }) => {
  await po.setUp();
  await po.goToLibraryTab();
  await po.createPrompt({
    title: "title1",
    description: "desc",
    content: "prompt1content",
  });

  await expect(po.page.getByTestId("prompt-card")).toMatchAriaSnapshot();

  await po.page.getByTestId("edit-prompt-button").click();
  await po.page
    .getByRole("textbox", { name: "Content" })
    .fill("prompt1content-edited");
  await po.page.getByRole("button", { name: "Save" }).click();

  await expect(po.page.getByTestId("prompt-card")).toMatchAriaSnapshot();
});

test("delete prompt", async ({ po }) => {
  await po.setUp();
  await po.goToLibraryTab();
  await po.createPrompt({
    title: "title1",
    description: "desc",
    content: "prompt1content",
  });

  await po.page.getByTestId("delete-prompt-button").click();
  await po.page.getByRole("button", { name: "Delete" }).click();

  await expect(po.page.getByTestId("prompt-card")).not.toBeVisible();
});

test("use prompt", async ({ po }) => {
  await po.setUp();
  await po.goToLibraryTab();
  await po.createPrompt({
    title: "title1",
    description: "desc",
    content: "prompt1content",
  });

  await po.goToAppsTab();
  await po.getChatInput().click();
  await po.getChatInput().fill("[dump] @");
  await po.page.getByRole("menuitem", { name: "Choose title1" }).click();
  await po.page.getByRole("button", { name: "Send message" }).click();
  await po.waitForChatCompletion();

  await po.snapshotServerDump("last-message");
});
