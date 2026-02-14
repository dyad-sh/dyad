import { test } from "./helpers/test_helper";
import { expect } from "@playwright/test";

test("create and edit prompt", async ({ po }) => {
  await po.setUp();
  await po.navigation.goToLibraryTab();
  await po.page.getByRole("link", { name: "Prompts" }).click();
  await po.promptLibrary.createPrompt({
    title: "title1",
    description: "desc",
    content: "prompt1content",
  });

  // Wait for prompt card to be fully rendered
  const promptCard = po.page.getByTestId("prompt-card");
  await expect(promptCard).toBeVisible();
  await expect(
    promptCard.getByRole("heading", { name: "title1" }),
  ).toBeVisible();
  await expect(promptCard).toContainText("desc");
  await expect(promptCard).toContainText("prompt1content");

  await po.page.getByTestId("edit-prompt-button").click();
  await po.page
    .getByRole("textbox", { name: "Content" })
    .fill("prompt1content-edited");
  await po.page.getByRole("button", { name: "Save" }).click();

  // Verify edited content is displayed
  await expect(promptCard).toBeVisible();
  await expect(
    promptCard.getByRole("heading", { name: "title1" }),
  ).toBeVisible();
  await expect(promptCard).toContainText("desc");
  await expect(promptCard).toContainText("prompt1content-edited");
});

test("delete prompt", async ({ po }) => {
  await po.setUp();
  await po.navigation.goToLibraryTab();
  await po.page.getByRole("link", { name: "Prompts" }).click();
  await po.promptLibrary.createPrompt({
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
  await po.navigation.goToLibraryTab();
  await po.page.getByRole("link", { name: "Prompts" }).click();
  await po.promptLibrary.createPrompt({
    title: "title1",
    description: "desc",
    content: "prompt1content",
  });

  await po.navigation.goToAppsTab();
  await po.chatActions.getChatInput().click();
  await po.chatActions.getChatInput().fill("[dump] @");
  await po.page.getByRole("menuitem", { name: "Choose title1" }).click();
  await po.page.getByRole("button", { name: "Send message" }).click();
  await po.chatActions.waitForChatCompletion();

  await po.snapshotServerDump("last-message");
});

test("slash menu shows skills and selecting one inserts command", async ({
  po,
}) => {
  await po.setUp();
  await po.navigation.goToLibraryTab();
  await po.page.getByRole("link", { name: "Prompts" }).click();
  await po.promptLibrary.createPrompt({
    title: "E2E Test Skill",
    description: "desc",
    content: "Run the E2E test skill content.",
  });

  await po.navigation.goToAppsTab();
  const chatInput = po.chatActions.getChatInput();
  await chatInput.click();
  await chatInput.fill("/");

  const skillsMenu = po.page.locator('[data-mentions-menu="true"]');
  await expect(skillsMenu).toBeVisible();
  await expect(skillsMenu).toContainText("e2e-test-skill");
  await expect(skillsMenu).toContainText("Skill");

  await skillsMenu.getByText("e2e-test-skill").click();
  await expect(chatInput).toContainText("/e2e-test-skill");
});
