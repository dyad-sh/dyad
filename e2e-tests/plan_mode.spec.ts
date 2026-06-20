import fs from "fs";
import path from "path";
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
    const appPath = await po.appManagement.getCurrentAppPath();
    await po.page.getByTestId("accept-plan-new-chat").click();

    // We should be redirected to a different, brand-new chat for implementation.
    await expect(async () => {
      const currentChatId = new URL(po.page.url()).searchParams.get("id");
      expect(currentChatId).not.toBeNull();
      expect(currentChatId).not.toEqual(planChatId);
    }).toPass({ timeout: Timeout.MEDIUM });

    // Accepting a plan persists it to .dyad/plans/ as a Markdown file.
    const planDir = path.join(appPath, ".dyad", "plans");
    await expect(async () => {
      const mdFiles = fs.readdirSync(planDir).filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
      const planContent = fs.readFileSync(
        path.join(planDir, mdFiles[0]),
        "utf-8",
      );
      expect(planContent).toContain("Test Plan");
    }).toPass({ timeout: Timeout.MEDIUM });

    await waitForNoActiveGeneration(po);
  },
);

testSkipIfWindows(
  "plan mode - accepting a plan starts implementation in the source app when selected app is stale",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await waitForInitialImportedChatCompletion(po);

    const sourceAppName = await po.appManagement.getCurrentAppName();
    const sourceAppPath = await po.appManagement.getCurrentAppPath();
    expect(sourceAppName).toBeTruthy();

    await po.chatActions.selectChatMode("plan");
    await po.sendPrompt("tc=local-agent/accept-plan", {
      skipWaitForCompletion: true,
    });
    await waitForPlanGenerationToFinish(po);
    await finishPlanPresentation(po);

    const planChatId = Number(new URL(po.page.url()).searchParams.get("id"));
    expect(planChatId).toBeGreaterThan(0);

    await po.navigation.goToAppsTab();
    await po.importApp("minimal-with-ai-rules");
    await expect(async () => {
      const currentAppName = await po.appManagement.getCurrentAppName();
      expect(currentAppName).not.toEqual(sourceAppName);
    }).toPass({ timeout: Timeout.MEDIUM });
    const otherAppName = await po.appManagement.getCurrentAppName();
    const otherAppPath = await po.appManagement.getCurrentAppPath();
    let otherChat: { appId: number } | null = null;
    await expect(async () => {
      const otherChatId = Number(new URL(po.page.url()).searchParams.get("id"));
      expect(otherChatId).toBeGreaterThan(0);
      expect(otherChatId).not.toEqual(planChatId);
      otherChat = await po.page.evaluate(async (chatId) => {
        return (window as any).electron.ipcRenderer.invoke("get-chat", chatId);
      }, otherChatId);
    }).toPass({ timeout: Timeout.MEDIUM });
    await po.appManagement.clickAppListItem({ appName: sourceAppName! });
    await po.page.getByRole("link", { name: "Apps" }).hover();
    await expect(po.page.getByTestId("chat-list-container")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await po.page.getByTestId(`chat-list-item-${planChatId}`).click();
    await expect(async () => {
      const currentChatId = Number(
        new URL(po.page.url()).searchParams.get("id"),
      );
      expect(currentChatId).toEqual(planChatId);
    }).toPass({ timeout: Timeout.MEDIUM });
    const viewPlanButton = po.page
      .getByRole("button", { name: "View Plan" })
      .last();
    await expect(viewPlanButton).toBeVisible({ timeout: Timeout.MEDIUM });
    await viewPlanButton.click();
    await expect(po.page.getByTestId("accept-plan-new-chat")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await po.page.getByTestId("accept-plan-new-chat").click();

    await po.appManagement.clickAppListItem({ appName: otherAppName! });
    await expect(po.appManagement.getTitleBarAppNameButton()).toHaveAttribute(
      "data-app-name",
      otherAppName!,
      { timeout: Timeout.MEDIUM },
    );

    let implementationChatId = 0;
    await expect(async () => {
      implementationChatId = Number(
        new URL(po.page.url()).searchParams.get("id"),
      );
      expect(implementationChatId).toBeGreaterThan(0);
      expect(implementationChatId).not.toEqual(planChatId);
    }).toPass({ timeout: Timeout.MEDIUM });

    const implementationChat = await po.page.evaluate(async (chatId) => {
      return (window as any).electron.ipcRenderer.invoke("get-chat", chatId);
    }, implementationChatId);
    const sourceChat = await po.page.evaluate(async (chatId) => {
      return (window as any).electron.ipcRenderer.invoke("get-chat", chatId);
    }, planChatId);

    expect(implementationChat.appId).toEqual(sourceChat.appId);
    expect(implementationChat.appId).not.toEqual(otherChat!.appId);

    const sourcePlanDir = path.join(sourceAppPath, ".dyad", "plans");
    const otherPlanDir = path.join(otherAppPath, ".dyad", "plans");
    await expect(async () => {
      const mdFiles = fs
        .readdirSync(sourcePlanDir)
        .filter((f) => f.endsWith(".md"));
      expect(mdFiles.length).toBeGreaterThan(0);
      const planContent = fs.readFileSync(
        path.join(sourcePlanDir, mdFiles[0]),
        "utf-8",
      );
      expect(planContent).toContain("Test Plan");
    }).toPass({ timeout: Timeout.MEDIUM });

    const otherPlanFiles = fs.existsSync(otherPlanDir)
      ? fs.readdirSync(otherPlanDir).filter((f) => f.endsWith(".md"))
      : [];
    expect(otherPlanFiles).toHaveLength(0);

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

    // Continuing here switches the chat out of plan mode into Agent mode so the
    // implementation turn runs in Agent rather than re-entering planning. A
    // silently failing updateChat IPC would leave this stuck on "Plan".
    await expect(po.page.getByTestId("chat-mode-selector")).toHaveAttribute(
      "aria-label",
      "Chat mode: Agent",
      { timeout: Timeout.MEDIUM },
    );

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
