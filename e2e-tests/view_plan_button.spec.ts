import { expect } from "@playwright/test";
import { Timeout, test } from "./helpers/test_helper";

test(
  "view plan button opens preview panel and shows plan",
  async ({ po }) => {
    // Set up app
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    
    // Switch to plan mode
    await po.chatActions.selectChatMode("plan");

    // Generate a plan by sending a prompt that triggers plan generation
    await po.sendPrompt("tc=local-agent/accept-plan");

    // Wait for the "View Plan" button to appear
    const viewPlanButton = po.page.getByRole("button", { name: "View Plan" });
    await expect(viewPlanButton).toBeVisible({ timeout: Timeout.MEDIUM });

    // Collapse the preview panel to simulate the issue scenario
    await po.previewPanel.clickTogglePreviewPanel();

    // Verify the preview panel is actually closed (plan content should be hidden)
    const planContent = po.previewPanel.getPlanContent();
    await expect(planContent).not.toBeVisible();

    // Click the "View Plan" button
    await viewPlanButton.click();

    // Assert that the plan content is visible (button opened the panel and switched to plan mode)
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);

test(
  "view plan button works on app startup when preview panel is closed",
  async ({ po }) => {
    // Set up app
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    
    // Switch to plan mode
    await po.chatActions.selectChatMode("plan");

    // Collapse preview panel immediately (simulating closed state on startup)
    await po.previewPanel.clickTogglePreviewPanel();

    // Generate a plan
    await po.sendPrompt("tc=local-agent/accept-plan");

    // Wait for the "View Plan" button to appear
    const viewPlanButton = po.page.getByRole("button", { name: "View Plan" });
    await expect(viewPlanButton).toBeVisible({ timeout: Timeout.MEDIUM });

    // Click the "View Plan" button
    await viewPlanButton.click();

    // Assert that the plan content is visible (button opened panel and switched to plan mode)
    const planContent = po.previewPanel.getPlanContent();
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);
