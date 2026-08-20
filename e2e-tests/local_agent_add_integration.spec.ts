import { expect } from "@playwright/test";
import { Timeout, testSkipIfWindows } from "./helpers/test_helper";

/**
 * End-to-end guard for the `add_integration` round trip.
 *
 * The local-agent tool parks the turn on a user-input request: the user picks a
 * provider in the chat card, finishes the connector in the Configure panel, and
 * clicks Continue. Main must arm the follow-up turn and dispatch it, so the
 * conversation resumes instead of stopping dead after Continue.
 *
 * The agent-mode branches of the chat stream handler return early, so they have
 * to report natural completion themselves. When they don't, the handler's
 * `finally` sweeps the armed request instead of dispatching its follow-up.
 */
testSkipIfWindows(
  "local-agent - finishing the database integration resumes the chat",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await po.chatActions.clickNewChat();
    await po.chatActions.selectLocalAgentMode();

    // The tool parks the turn on a user-input request rather than finishing the
    // conversation, so wait for the card it renders instead of chat completion.
    await po.sendPrompt("tc=local-agent/add-integration", {
      skipWaitForCompletion: true,
    });

    const messages = po.page.getByTestId("messages-list");
    await expect(
      messages.getByText("Let's connect a database first."),
    ).toBeVisible({ timeout: Timeout.LONG });

    // Pick a provider in the chat card, which hands off to the Configure panel.
    const supabaseRadio = messages.getByRole("radio", { name: /Supabase/ });
    await supabaseRadio.click();
    await expect(supabaseRadio).toHaveAttribute("aria-checked", "true");
    await messages.getByRole("button", { name: "Next" }).click();
    await expect(messages.getByTestId("integration-skip-button")).toBeHidden();

    // Both Continue buttons — the Configure panel's and the chat card's mirror —
    // stay disabled until the connector actually links a project.
    const chatContinue = po.page.getByTestId(
      "integration-chat-continue-button",
    );
    const panelContinue = po.page.getByTestId(
      "integration-setup-continue-button",
    );
    await expect(panelContinue).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(panelContinue).toBeDisabled();
    await expect(chatContinue).toBeDisabled();

    // Finish the connector where the card sent the user.
    await po.appManagement.clickConnectSupabaseButton();
    await expect(po.page.getByText("Fake Supabase Project")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });

    await expect(panelContinue).toBeEnabled({ timeout: Timeout.MEDIUM });
    await panelContinue.click();

    // The regression: the armed follow-up is dispatched as a real turn, so the
    // conversation keeps going instead of stopping after Continue.
    await expect(
      messages.getByText(
        "Continue. I have completed the supabase integration.",
      ),
    ).toBeVisible({ timeout: Timeout.LONG });

    // The request settled: the card drops its pending controls and switches to
    // the completed state.
    await expect(chatContinue).toBeHidden();
    await expect(
      messages.getByText("Supabase integration complete"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);

testSkipIfWindows(
  "local-agent - skipping database integration resumes without a provider",
  async ({ po }) => {
    await po.setUpDyadPro({ localAgent: true });
    await po.importApp("minimal");
    await po.chatActions.waitForChatCompletion({ timeout: Timeout.LONG });
    await po.chatActions.clickNewChat();
    await po.chatActions.selectLocalAgentMode();

    await po.sendPrompt("tc=local-agent/add-integration", {
      skipWaitForCompletion: true,
    });

    const messages = po.page.getByTestId("messages-list");
    await expect(
      messages.getByText("Let's connect a database first."),
    ).toBeVisible({ timeout: Timeout.LONG });

    const completedAssistantMessages = messages.getByTestId(
      "copy-message-button",
    );
    const assistantCountBeforeSkip = await completedAssistantMessages.count();
    const skipButton = messages.getByTestId("integration-skip-button");
    await expect(skipButton).toBeEnabled({ timeout: Timeout.MEDIUM });
    await skipButton.click();

    await expect(
      messages.getByText("We don't want to use Supabase or Neon right now"),
    ).toBeVisible({ timeout: Timeout.LONG });
    await expect(messages.getByText("Integration skipped")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(
      messages.getByText("No database integration was added."),
    ).toBeVisible();
    await expect(
      po.page.getByTestId("integration-setup-continue-button"),
    ).toBeHidden();
    await expect(po.page.getByTestId("preview-mode-button")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    // A new completed assistant message proves that the synthetic user message
    // resumed the agent turn. This is tied to the fresh chat above, rather than
    // the global Retry footer left by the import-time conversation.
    await expect
      .poll(() => completedAssistantMessages.count(), {
        timeout: Timeout.LONG,
      })
      .toBeGreaterThan(assistantCountBeforeSkip);

    // The tool persists its terminal card outcome, so replaying the chat does
    // not turn the skipped card back into a stale provider chooser.
    const skippedChatId = new URL(po.page.url()).searchParams.get("id");
    expect(skippedChatId).not.toBeNull();
    await po.chatActions.clickNewChat();
    await po.page
      .getByTestId(`chat-tab-${skippedChatId}`)
      .locator("button")
      .first()
      .click();
    await expect(
      po.page.getByTestId("messages-list").getByText("Integration skipped"),
    ).toBeVisible({ timeout: Timeout.LONG });
  },
);
