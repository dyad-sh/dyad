import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { Timeout, test } from "./helpers/test_helper";

test("plan mode - accept plan redirects to new chat and saves to disk", async ({
  po,
}) => {
  test.setTimeout(180000);
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectChatMode("plan");

  // Get app path before accepting (needed to check saved plan)
  const appPath = await po.getCurrentAppPath();

  // Trigger write_plan fixture
  await po.sendPrompt("tc=local-agent/accept-plan");

  // Capture current chat ID from URL
  const initialUrl = po.page.url();
  const initialChatIdMatch = initialUrl.match(/[?&]id=(\d+)/);
  expect(initialChatIdMatch).not.toBeNull();
  const initialChatId = initialChatIdMatch![1];

  // Wait for plan panel to appear
  const acceptButton = po.page.getByRole("button", { name: "Accept Plan" });
  await expect(acceptButton).toBeVisible({ timeout: Timeout.MEDIUM });

  // Accept the plan (plans are now always saved to .dyad/plans/)
  await acceptButton.click();

  // Wait for navigation to a different chat
  await expect(async () => {
    const currentUrl = po.page.url();
    const match = currentUrl.match(/[?&]id=(\d+)/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toEqual(initialChatId);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Verify plan was saved to .dyad/plans/
  const planDir = path.join(appPath!, ".dyad", "plans");
  let mdFiles: string[] = [];
  await expect(async () => {
    const files = fs.readdirSync(planDir);
    mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles.length).toBeGreaterThan(0);
  }).toPass({ timeout: Timeout.MEDIUM });

  // Verify plan content
  const planContent = fs.readFileSync(path.join(planDir, mdFiles[0]), "utf-8");
  expect(planContent).toContain("Test Plan");
});

test("plan mode - questionnaire flow", async ({ po }) => {
  test.setTimeout(180000);
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.selectChatMode("plan");

  // Trigger questionnaire fixture
  await po.sendPrompt("tc=local-agent/questionnaire");

  // Wait for questionnaire UI to appear
  await expect(po.page.getByText("Project Requirements")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Select "Vue" radio option by clicking the label text (Base UI Radio components)
  await po.page.getByText("Vue", { exact: true }).click();

  // Click Submit (single question → Submit button shown)
  await po.page.getByRole("button", { name: /Submit/ }).click();

  // Wait for the LLM response to the submitted answers
  await po.waitForChatCompletion();

  // Snapshot the messages
  await po.snapshotMessages();
});
