import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows(
  "plan mode - accept plan redirects to new chat and saves to disk",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectChatMode("plan");

    // Get app path before accepting (needed to check saved plan)
    const appPath = await po.appManagement.getCurrentAppPath();

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
    const planContent = fs.readFileSync(
      path.join(planDir, mdFiles[0]),
      "utf-8",
    );
    expect(planContent).toContain("Test Plan");
  },
);

testSkipIfWindows("plan mode - questionnaire flow", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.selectChatMode("plan");

  // Trigger questionnaire fixture
  await po.sendPrompt("tc=local-agent/questionnaire", {
    skipWaitForCompletion: true,
  });

  // Wait for questionnaire UI to appear
  await expect(po.page.getByText("Which framework do you prefer?")).toBeVisible(
    {
      timeout: Timeout.MEDIUM,
    },
  );

  await expect(po.page.getByRole("button", { name: "Submit" })).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Select "Vue" radio option
  await po.page.getByText("Vue", { exact: true }).click();

  // Submit the questionnaire
  await po.page.getByRole("button", { name: /Submit/ }).click();

  // Wait for the LLM response after submitting answers
  await po.chatActions.waitForChatCompletion();

  // Snapshot the messages
  await po.snapshotMessages();
});
