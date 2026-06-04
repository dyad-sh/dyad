import { expect } from "@playwright/test";
import {
  type PageObject,
  Timeout,
  testSkipIfWindows,
} from "./helpers/test_helper";

function getCancelGenerationButton(po: PageObject) {
  return po.page.getByRole("button", { name: "Cancel generation" });
}

async function waitForNoActiveGeneration(po: PageObject) {
  await expect(getCancelGenerationButton(po)).toBeHidden({
    timeout: Timeout.MEDIUM,
  });
}

async function waitForInitialImportedChatCompletion(po: PageObject) {
  await expect(po.page.getByTestId("messages-list")).toContainText("More EOM", {
    timeout: Timeout.MEDIUM,
  });
  await waitForNoActiveGeneration(po);
}

async function sendPromptAndWaitForResponse(
  po: PageObject,
  prompt: string,
  responseText: string,
) {
  await po.sendPrompt(prompt, {
    skipWaitForCompletion: true,
  });

  await expect(po.page.getByTestId("messages-list")).toContainText(
    responseText,
    {
      timeout: Timeout.MEDIUM,
    },
  );
  await waitForNoActiveGeneration(po);
}

async function waitForPlanGenerationToFinish(po: PageObject) {
  await expect(po.page.getByTestId("accept-plan-new-chat")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await waitForNoActiveGeneration(po);
}

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
  "plan mode - accept plan and start a new chat",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await waitForInitialImportedChatCompletion(po);

    // Start an existing chat in the default (Agent v2) mode.
    await sendPromptAndWaitForResponse(
      po,
      "tc=local-agent/simple-response",
      "Hello! I understand your request.",
    );

    // Switch to plan mode and generate a plan.
    await po.chatActions.selectChatMode("plan");
    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });
    await waitForPlanGenerationToFinish(po);

    // Continue past the plan presentation so the write_plan tool turn is
    // flushed; otherwise the acceptance message gets bundled with the pending
    // tool result and the exit_plan transition never fires.
    await finishPlanPresentation(po);

    // Capture the plan chat ID so we can confirm we get redirected away to a
    // brand-new implementation chat.
    const planChatId = new URL(po.page.url()).searchParams.get("id");
    expect(planChatId).not.toBeNull();

    // Accept the plan and choose to implement it in a brand-new chat.
    await po.page.getByTestId("accept-plan-new-chat").click();

    // We should be redirected to a different, brand-new chat for implementation.
    await expect(async () => {
      const currentChatId = new URL(po.page.url()).searchParams.get("id");
      expect(currentChatId).not.toBeNull();
      expect(currentChatId).not.toEqual(planChatId);
    }).toPass({ timeout: Timeout.MEDIUM });

    await waitForNoActiveGeneration(po);
  },
);

testSkipIfWindows(
  "plan mode - accept plan and continue here",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await waitForInitialImportedChatCompletion(po);

    // Start an existing chat in the default (Agent v2) mode.
    await sendPromptAndWaitForResponse(
      po,
      "tc=local-agent/simple-response",
      "Hello! I understand your request.",
    );

    // Switch to plan mode and generate a plan.
    await po.chatActions.selectChatMode("plan");
    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });
    await waitForPlanGenerationToFinish(po);

    // Continue past the plan presentation so the write_plan tool turn is
    // flushed; otherwise the acceptance message gets bundled with the pending
    // tool result and the exit_plan transition never fires.
    await finishPlanPresentation(po);

    // Capture the plan chat ID so we can confirm implementation continues in it.
    const planChatId = new URL(po.page.url()).searchParams.get("id");
    expect(planChatId).not.toBeNull();

    // Accept the plan and choose to continue implementing in this same chat.
    await po.page.getByTestId("accept-plan-continue-here").click();

    // The accept buttons disappear once the plan has been accepted.
    await expect(po.page.getByTestId("accept-plan-continue-here")).toBeHidden({
      timeout: Timeout.MEDIUM,
    });

    // We should still be in the plan chat (no redirect to a fresh chat).
    const currentChatId = new URL(po.page.url()).searchParams.get("id");
    expect(currentChatId).toEqual(planChatId);

    await waitForNoActiveGeneration(po);
  },
);

testSkipIfWindows("plan mode - questionnaire flow", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await po.chatActions.clickNewChat();
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
