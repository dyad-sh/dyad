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
    await po.importApp("minimal");
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
