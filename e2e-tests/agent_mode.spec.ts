import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

const PLAN_PROMPT = `[dyad-qa=agent-plan] bootstrap agent response`;

test("agent tags render with rich UI", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.importApp("minimal");

  await po.selectChatMode("agent");
  await po.sendPrompt(PLAN_PROMPT);
  await po.waitForChatCompletion();

  const chat = po.page.getByTestId("messages-list");
  await expect(chat.getByText("Agent Analysis")).toBeVisible();
  await expect(chat.getByText("Do the thing")).toBeVisible();
  await expect(chat.getByText("Workflow status ? Plan ready")).toBeVisible();
  await expect(chat.getByText("Auto-advance enabled")).toBeVisible();
  await expect(chat.getByText("Focus shifted to TD-01")).toBeVisible();
});
