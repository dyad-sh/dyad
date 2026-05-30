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
  await expect(
    po.page.getByRole("button", { name: "Accept Plan" }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await waitForNoActiveGeneration(po);
}

testSkipIfWindows(
  "plan mode - switch to plan mode in an existing chat",
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

    // Capture the existing chat ID so we can confirm we stay in the same chat.
    const initialUrl = po.page.url();
    const initialChatIdMatch = initialUrl.match(/[?&]id=(\d+)/);
    expect(initialChatIdMatch).not.toBeNull();
    const initialChatId = initialChatIdMatch![1];

    // Switch to plan mode within the existing chat.
    await po.chatActions.selectChatMode("plan");

    // Send a prompt that triggers a plan in the now plan-mode chat. Switching to
    // plan mode in a chat with messages prompts the user to choose between a
    // fresh chat or continuing here, so don't wait for completion yet.
    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });

    // Choose to continue in the same chat, then let the plan finish streaming.
    await po.page.getByTestId("plan-mode-continue-same-chat").click();
    await waitForPlanGenerationToFinish(po);

    // The plan should be presented in the same chat.
    await expect(
      po.page.getByRole("button", { name: "Accept Plan" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    const planContent = po.previewPanel.getPlanContent();
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });

    // We should still be in the same existing chat (no redirect yet).
    const currentChatId = new URL(po.page.url()).searchParams.get("id");
    expect(currentChatId).toEqual(initialChatId);
  },
);

testSkipIfWindows(
  "plan mode - switch to plan mode in an existing chat (new chat)",
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

    // Capture the existing chat ID so we can confirm we get redirected away.
    const initialUrl = po.page.url();
    const initialChatIdMatch = initialUrl.match(/[?&]id=(\d+)/);
    expect(initialChatIdMatch).not.toBeNull();
    const initialChatId = initialChatIdMatch![1];

    // Switch to plan mode within the existing chat.
    await po.chatActions.selectChatMode("plan");

    // Sending a prompt after switching to plan mode in a chat with messages
    // opens the choice dialog instead of submitting immediately.
    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });

    // Choose to start a fresh chat for a clean context.
    await po.page.getByTestId("plan-mode-new-chat").click();

    // We should be redirected to a different, brand-new chat.
    await expect(async () => {
      const currentChatId = new URL(po.page.url()).searchParams.get("id");
      expect(currentChatId).not.toBeNull();
      expect(currentChatId).not.toEqual(initialChatId);
    }).toPass({ timeout: Timeout.MEDIUM });

    await waitForPlanGenerationToFinish(po);

    // The plan should be presented in the new chat.
    await expect(
      po.page.getByRole("button", { name: "Accept Plan" }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });

    const planContent = po.previewPanel.getPlanContent();
    await expect(planContent).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);

testSkipIfWindows("plan mode - questionnaire flow", async ({ po }) => {
  await po.setUpDyadPro({ localAgent: true });
  await po.importApp("minimal");
  await waitForInitialImportedChatCompletion(po);
  await po.chatActions.selectChatMode("plan");

  // Trigger questionnaire fixture
  await po.sendPrompt("tc=local-agent/questionnaire", {
    skipWaitForCompletion: true,
  });

  // Imported chats already contain the initial import message, so switching to
  // plan mode triggers the new-chat choice dialog. Continue in the same chat.
  await po.page.getByTestId("plan-mode-continue-same-chat").click();

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
  await waitForNoActiveGeneration(po);

  // Snapshot the messages
  await po.snapshotMessages();
});

testSkipIfWindows(
  "plan mode - add and review plan annotations",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await waitForInitialImportedChatCompletion(po);
    await po.chatActions.selectChatMode("plan");

    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });

    // Imported chats already contain the initial import message, so switching to
    // plan mode triggers the new-chat choice dialog. Continue in the same chat.
    await po.page.getByTestId("plan-mode-continue-same-chat").click();
    await waitForPlanGenerationToFinish(po);

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
    await waitForNoActiveGeneration(po);

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
    await waitForInitialImportedChatCompletion(po);

    // Switch to plan mode
    await po.chatActions.selectChatMode("plan");

    // Generate a plan by sending a prompt that triggers plan generation
    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });

    // Imported chats already contain the initial import message, so switching to
    // plan mode triggers the new-chat choice dialog. Continue in the same chat.
    await po.page.getByTestId("plan-mode-continue-same-chat").click();
    await waitForPlanGenerationToFinish(po);

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
