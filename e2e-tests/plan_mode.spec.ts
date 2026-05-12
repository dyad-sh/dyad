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

    // The "We've switched you to a new chat" sonner toast at the bottom-right
    // can overlap the Accept Plan button. Dismiss it so a normal click works
    // and Playwright's actionability checks are honored.
    await expect(async () => {
      await po.toastNotifications.dismissAllToasts();
      await expect(acceptButton).toBeEnabled({ timeout: 1_000 });
      try {
        await acceptButton.click({ timeout: 1_000 });
      } catch (error) {
        const currentChatId = new URL(po.page.url()).searchParams.get("id");
        if (currentChatId && currentChatId !== initialChatId) {
          return;
        }
        throw error;
      }
    }).toPass({ timeout: Timeout.MEDIUM });

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

testSkipIfWindows(
  "plan mode - add and review plan annotations",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.selectChatMode("plan");

    await po.sendPrompt("tc=local-agent/accept-plan");

    await expect(
      po.page.getByRole("button", { name: "Accept Plan" }),
    ).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await po.previewPanel.selectTextInPlan("Step two");

    const addCommentButton = po.previewPanel.getPlanSelectionCommentButton();
    await expect(addCommentButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await addCommentButton.click();
    await expect(po.page.getByRole("button", { name: "Cancel" })).toBeVisible();
    await po.page.getByRole("button", { name: "Cancel" }).click();

    await expect(po.page.getByPlaceholder("Add your comment...")).toBeHidden();
    await expect(addCommentButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await addCommentButton.click();

    await po.page
      .getByPlaceholder("Add your comment...")
      .fill("Add more detail for step two.");

    await po.previewPanel.getPlanContent().evaluate((container) => {
      let scrollParent: HTMLElement | null = container.parentElement;

      while (scrollParent) {
        const { overflowY } = window.getComputedStyle(scrollParent);
        const isScrollable =
          overflowY === "auto" ||
          overflowY === "scroll" ||
          overflowY === "overlay";
        if (isScrollable) {
          scrollParent.scrollTop += 48;
          scrollParent.dispatchEvent(new Event("scroll"));
          return;
        }

        scrollParent = scrollParent.parentElement;
      }

      throw new Error("Could not find a scrollable plan container");
    });

    await expect(po.page.getByPlaceholder("Add your comment...")).toHaveValue(
      "Add more detail for step two.",
    );
    await po.page.getByRole("button", { name: "Add Comment" }).click();

    const commentsButton = po.previewPanel.getPlanCommentsButton();
    await expect(commentsButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(po.previewPanel.getPlanAnnotationMarks()).toHaveCount(1);
    await expect(
      po.previewPanel.getPlanAnnotationMarks().first(),
    ).toContainText("Step two");
    await expect(
      po.previewPanel.getPlanAnnotationMarks().first(),
    ).toHaveAttribute("role", "button");

    await commentsButton.click();
    await expect(po.page.getByText("Comments (1)")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(
      po.page.getByText("Add more detail for step two."),
    ).toBeVisible();

    await commentsButton.click();
    await expect(po.page.getByText("Comments (1)")).toBeHidden();

    await po.previewPanel.getPlanAnnotationMarks().first().press("Enter");
    const commentDialog = po.page.getByRole("dialog", {
      name: "Comment on selected text",
    });
    await expect(commentDialog).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      po.page.getByRole("button", { name: "Edit comment" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      po.page.getByRole("button", { name: "Edit comment" }),
    ).toBeFocused();
    await expect(
      po.page.getByText("Add more detail for step two."),
    ).toBeVisible();

    // Close the comment dialog and send the annotations
    await po.page.keyboard.press("Escape");
    await expect(commentDialog).toBeHidden();

    await commentsButton.click();
    await expect(po.page.getByText("Comments (1)")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.page.getByRole("button", { name: "Send Comments" }).click();

    // Wait for annotations to be cleared (indicates send succeeded)
    await expect(po.previewPanel.getPlanAnnotationMarks()).toHaveCount(0, {
      timeout: Timeout.MEDIUM,
    });

    // Verify the request sent to the server contains the correctly formatted comments
    await po.snapshotServerDump("last-message");
  },
);

testSkipIfWindows(
  "plan mode - view plan button opens preview panel when collapsed",
  async ({ po }) => {
    // Set up app
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");

    // Switch to plan mode
    await po.chatActions.selectChatMode("plan");

    // Generate a plan by sending a prompt that triggers plan generation
    await po.sendPrompt("tc=local-agent/accept-plan");

    // Wait for the "View Plan" button to appear
    const viewPlanButton = po.page
      .getByRole("button", { name: "View Plan" })
      .last();
    await expect(viewPlanButton).toBeVisible({ timeout: Timeout.MEDIUM });

    // Verify plan content is visible
    const planContent = po.previewPanel.getPlanContent();
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });

    // Collapse the preview panel
    await po.previewPanel.clickTogglePreviewPanel();

    // Verify the preview panel is actually closed (plan content should be hidden)
    await expect(planContent).not.toBeVisible();

    // Click the "View Plan" button
    await viewPlanButton.click();

    // Assert that the plan content is visible (button opened the panel and switched to plan mode)
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);
