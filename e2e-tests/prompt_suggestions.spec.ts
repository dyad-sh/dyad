import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

const ADD_CONTACT_FORM_PROMPT =
  "Add a contact form to this page with name, email, and message fields.";

test("AI prompt suggestions: visible after AI response, hover shows full prompt, click inserts into input", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");
  await po.chatActions.clickNewChat();
  await po.chatActions.selectChatMode("build");
  await po.sendPrompt("tc=prompt-suggestions");
  await po.chatActions.waitForChatCompletion();

  const container = po.chatActions.getChatInputContainer();
  const suggestions = container.getByTestId("prompt-suggestion-buttons");
  await expect(suggestions).toBeVisible();

  const addContactFormButton = po.page.getByRole("button", {
    name: "Add a contact form",
  });
  await expect(addContactFormButton).toBeVisible();

  await addContactFormButton.hover();
  const tooltip = po.page.getByRole("tooltip");
  await expect(tooltip).toBeVisible();
  await expect(tooltip).toContainText(ADD_CONTACT_FORM_PROMPT);

  await addContactFormButton.click();
  await expect(po.chatActions.getChatInput()).toContainText(
    ADD_CONTACT_FORM_PROMPT,
  );
});
