import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("regular Dyad tool cards, questionnaire and plan visual reference", async ({
  po,
}) => {
  test.skip(
    process.env.DYAD_REAL_CLAUDE_SMOKE !== "1",
    "Opt-in paired visual comparison with the Claude smoke suite",
  );
  test.setTimeout(180_000);
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.clickNewChat();
  await po.sendPrompt("tc=local-agent/basic-write", {
    skipWaitForCompletion: true,
  });
  await po.page
    .getByRole("button", { name: "Allow once", exact: true })
    .click();
  await po.chatActions.waitForChatCompletion();
  await po.page.screenshot({
    path: "test-results/dyad-tool-cards.png",
    fullPage: true,
  });
  await po.chatActions.selectChatMode("plan");
  await po.sendPrompt("tc=local-agent/questionnaire", {
    skipWaitForCompletion: true,
  });
  await expect(
    po.page.getByRole("button", { name: "Submit", exact: true }),
  ).toBeVisible();
  await po.page.screenshot({
    path: "test-results/dyad-questionnaire.png",
    fullPage: true,
  });
  await po.page.getByText("React", { exact: true }).click();
  await po.page.getByRole("button", { name: "Submit", exact: true }).click();
  await po.chatActions.waitForChatCompletion();
  await po.sendPrompt("tc=local-agent/accept-plan");
  await expect(po.page.getByTestId("accept-plan-new-chat")).toBeVisible();
  await po.page.screenshot({
    path: "test-results/dyad-plan.png",
    fullPage: true,
  });
});
