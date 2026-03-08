import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

const ADD_CONTACT_FORM_PROMPT =
  "Add a contact form to this page with name, email, and message fields.";

test("AI prompt suggestions: visible after AI response and click inserts into input", async ({
  po,
}) => {
  await po.setUp({ autoApprove: true });
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectLocalAgentMode();
  await po.sendPrompt("tc=local-agent/prompt-suggestions");
  await po.chatActions.waitForChatCompletion();

  const container = po.chatActions.getChatInputContainer();
  const suggestions = container.getByTestId("prompt-suggestion-buttons");
  await expect(suggestions).toBeVisible();

  const addContactFormButton = po.page.getByRole("button", {
    name: "Add a contact form",
  });
  await expect(addContactFormButton).toBeVisible();

  await addContactFormButton.click();
  await expect(po.chatActions.getChatInput()).toContainText(
    ADD_CONTACT_FORM_PROMPT,
  );
});
