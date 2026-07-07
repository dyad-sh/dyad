import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

async function finishPlanPresentation(po: any) {
  await po.page.getByRole("button", { name: "Keep going" }).click();
  await po.chatActions.waitForChatCompletion();
  await expect(
    po.page.getByText(
      "I've presented the implementation plan. You can review it in the preview panel and accept it when ready.",
    ),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
}

testSkipIfWindows(
  "plan mode - add and review plan annotations",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.clickNewChat();
    await po.chatActions.selectChatMode("plan");

    await po.sendPrompt("tc=local-agent/accept-plan");
    await finishPlanPresentation(po);

    await expect(po.page.getByTestId("accept-plan-new-chat")).toBeVisible({
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
    await po.chatActions.clickNewChat();

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
