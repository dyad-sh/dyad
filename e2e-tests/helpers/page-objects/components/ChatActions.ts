/**
 * Page object for chat-related actions.
 * Handles sending prompts, chat input, and chat mode selection.
 */

import { Page, expect } from "@playwright/test";
import { Timeout } from "../../constants";

export class ChatActions {
  constructor(public page: Page) {}

  getHomeChatInputContainer() {
    return this.page.getByTestId("home-chat-input-container");
  }

  getChatInputContainer() {
    return this.page.getByTestId("chat-input-container");
  }

  getChatInput() {
    return this.page.locator(
      '[data-lexical-editor="true"][aria-placeholder^="Ask Dyad to build"]',
    );
  }

  /**
   * Clears the Lexical chat input using keyboard shortcuts (Meta+A, Backspace).
   * Uses toPass() for resilience since Lexical may need time to update its state.
   */
  async clearChatInput() {
    const chatInput = this.getChatInput();
    await chatInput.click();
    await this.page.keyboard.press("ControlOrMeta+a");
    await this.page.keyboard.press("Backspace");
    await expect(async () => {
      const text = await chatInput.textContent();
      expect(text?.trim()).toBe("");
    }).toPass({ timeout: Timeout.SHORT });
  }

  /**
   * Opens the chat history menu by clearing the input and pressing ArrowUp.
   * Uses toPass() for resilience since the Lexical editor may need time to
   * update its state before the history menu can be triggered.
   */
  async openChatHistoryMenu() {
    const historyMenu = this.page.locator('[data-mentions-menu="true"]');
    await expect(async () => {
      await this.clearChatInput();
      await this.page.keyboard.press("ArrowUp");
      await expect(historyMenu).toBeVisible({ timeout: 500 });
    }).toPass({ timeout: Timeout.SHORT });
  }

  async clickNewChat({ index = 0 }: { index?: number } = {}) {
    // There are two new chat buttons.
    const previousChatId = new URL(this.page.url()).searchParams.get("id");

    await this.page.getByTestId("new-chat-button").nth(index).click();

    await expect(async () => {
      const currentChatId = new URL(this.page.url()).searchParams.get("id");
      if (previousChatId === null) {
        expect(currentChatId).not.toBeNull();
      } else {
        expect(currentChatId).not.toBe(previousChatId);
      }

      const chatInput = this.getChatInput();
      await expect(chatInput).toBeVisible({ timeout: 1_000 });
      const text = await chatInput.textContent({ timeout: 1_000 });
      expect(text?.trim() ?? "").toBe("");
    }).toPass({ timeout: Timeout.MEDIUM });
  }

  private getRetryButton() {
    return this.page.getByRole("button", { name: "Retry" });
  }

  private getUndoButton() {
    return this.page.getByRole("button", { name: "Undo" });
  }

  async waitForChatCompletion({
    timeout = Timeout.MEDIUM,
  }: { timeout?: number } = {}) {
    await expect(this.getRetryButton()).toBeVisible({
      timeout,
    });
  }

  async clickRetry() {
    await this.getRetryButton().click();
  }

  async clickUndo() {
    await this.getUndoButton().click();
  }

  async sendPrompt(
    prompt: string,
    {
      skipWaitForCompletion = false,
      timeout,
    }: { skipWaitForCompletion?: boolean; timeout?: number } = {},
  ) {
    // Retry fill + assertions to survive Lexical/jotai races during chat
    // switches: the per-chat input atom is keyed off selectedChatIdAtom and
    // there's a render window where the editor's onChange writes to the old
    // chat's slot. In that case ExternalValueSyncPlugin clears the editor on
    // the next render, so the Send button stays disabled. Re-filling once the
    // atoms have settled deterministically recovers.
    const chatInput = this.getChatInput();
    const sendButton = this.page.getByRole("button", { name: "Send message" });

    await expect(chatInput).toBeVisible();
    await expect(async () => {
      await chatInput.click();
      await chatInput.fill(prompt);
      const visiblePrompt = prompt.replace(/@app:/g, "@");
      expect(await chatInput.textContent()).toContain(visiblePrompt);
      await expect(sendButton).toBeEnabled({ timeout: 1_000 });
      try {
        await sendButton.click({ timeout: 1_000 });
      } catch (error) {
        const promptSubmitted = await this.page
          .getByTestId("messages-list")
          .getByText(visiblePrompt)
          .last()
          .isVisible({ timeout: 1_000 })
          .catch(() => false);
        const generationStarted = await this.page
          .getByRole("button", { name: "Cancel generation" })
          .isVisible({ timeout: 500 })
          .catch(() => false);
        const inputText = await chatInput
          .textContent({ timeout: 500 })
          .catch(() => "");

        if (promptSubmitted || (generationStarted && !inputText?.trim())) {
          return;
        }
        throw error;
      }
    }).toPass({ timeout: Timeout.MEDIUM });

    if (!skipWaitForCompletion) {
      await this.waitForChatCompletion({ timeout });
    }
  }

  async selectChatMode(
    mode: "build" | "ask" | "agent" | "local-agent" | "basic-agent" | "plan",
  ) {
    await this.page.getByTestId("chat-mode-selector").click();
    const mapping: Record<string, string> = {
      build: "Build Generate and edit code",
      ask: "Ask Ask",
      agent: "Build with MCP",
      "local-agent": "Agent v2",
      "basic-agent": "Basic Agent", // For free users
      plan: "Plan.*Design before you build",
    };
    const optionName = mapping[mode];
    await this.page
      .getByRole("option", {
        name: new RegExp(optionName),
      })
      .click();
  }

  async selectLocalAgentMode() {
    await this.selectChatMode("local-agent");
  }

  async snapshotChatInputContainer() {
    await expect(this.getChatInputContainer()).toMatchAriaSnapshot();
  }
}
