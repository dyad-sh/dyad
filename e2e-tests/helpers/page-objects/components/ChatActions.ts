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
    return this.getChatInputContainer().locator('[data-lexical-editor="true"]');
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

  async dismissFloatingOverlays() {
    const tooltipOverlay = this.page.locator(
      '[data-slot="tooltip-content"][data-open]',
    );
    if (await tooltipOverlay.count()) {
      await this.page.keyboard.press("Escape");
      await expect(tooltipOverlay).toHaveCount(0, { timeout: Timeout.SHORT });
    }
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

  clickNewChat({ index = 0 }: { index?: number } = {}) {
    // There is two new chat buttons...
    return this.page.getByTestId("new-chat-button").nth(index).click();
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
    const chatInput = this.getChatInput();
    const sendButton = this.page.getByRole("button", { name: "Send message" });

    // Wait until Lexical is editable (it may be temporarily disabled during mode restore)
    await expect(async () => {
      const isEditable = await chatInput.isEditable();
      expect(isEditable).toBe(true);
    }).toPass({ timeout: Timeout.MEDIUM });

    // Lexical can drop early input during focus/restore transitions.
    // Retry the full interaction and assert the user-visible success condition.
    await expect(async () => {
      await chatInput.click();
      await this.page.keyboard.press("ControlOrMeta+a");
      await this.page.keyboard.press("Backspace");
      await this.page.keyboard.type(prompt);
      const isEnabled = await sendButton.isEnabled();
      expect(isEnabled).toBe(true);
    }).toPass({ timeout: Timeout.MEDIUM });

    await sendButton.click();
    if (!skipWaitForCompletion) {
      await this.waitForChatCompletion({ timeout });
    }
  }

  async selectChatMode(
    mode: "build" | "ask" | "agent" | "local-agent" | "basic-agent" | "plan",
  ) {
    await this.dismissFloatingOverlays();
    const selector = this.page.getByTestId("chat-mode-selector");
    await expect(selector).toBeVisible({ timeout: Timeout.MEDIUM });

    // Wait for selector to be enabled (not disabled) before clicking
    await expect(async () => {
      const isDisabled = await selector.isDisabled();
      expect(isDisabled).toBe(false);
    }).toPass({ timeout: Timeout.MEDIUM });

    await selector.click({ force: true });
    const mapping: Record<string, RegExp> = {
      build: /^Build/,
      ask: /^Ask/,
      agent: /^Agent/,
      "local-agent": /^Agent/,
      "basic-agent": /Basic Agent/,
      plan: /^Plan/,
    };
    const optionName = mapping[mode];

    const option = this.page.getByRole("option", {
      name: optionName,
    });

    await expect(option).toBeVisible({ timeout: Timeout.MEDIUM });
    await option.click({ force: true });
    // Dismiss any open tooltips after mode selection
    await this.page.keyboard.press("Escape");
  }

  async selectLocalAgentMode() {
    await this.selectChatMode("local-agent");
  }

  async getChatMode(): Promise<string> {
    const modeButton = this.page.getByTestId("chat-mode-selector");
    return (await modeButton.textContent()) || "";
  }

  async snapshotChatInputContainer() {
    await expect(this.getChatInputContainer()).toMatchAriaSnapshot();
  }
}
