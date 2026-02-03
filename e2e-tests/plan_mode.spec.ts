import fs from "node:fs";
import path from "node:path";
import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

testSkipIfWindows(
  "plan mode - accept plan redirects to new chat and saves to disk",
  async ({ po }) => {
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

    // Check "Save plan for later reference"
    await po.page.getByLabel(/Save plan for later reference/).click();

    // Accept the plan
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
    const files = fs.readdirSync(planDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));
    expect(mdFiles.length).toBeGreaterThan(0);

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
  await po.selectChatMode("plan");

  // Trigger questionnaire fixture
  await po.sendPrompt("tc=local-agent/questionnaire");

  // Wait for questionnaire UI to appear
  await expect(po.page.getByText("Project Requirements")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });

  // Select "React" radio option
  await po.page.getByLabel("React").click();

  // Click Submit (single question → Submit button shown)
  await po.page.getByRole("button", { name: /Submit/ }).click();

  // Wait for the LLM response to the submitted answers
  await po.waitForChatCompletion();

  // Snapshot the messages
  await po.snapshotMessages();
});
