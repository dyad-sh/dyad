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
      '[data-lexical-editor="true"][aria-placeholder^="Ask Coney to build"]',
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

  async waitForChatCompletion() {
    await expect(this.getRetryButton()).toBeVisible({
      timeout: Timeout.MEDIUM,
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
    { skipWaitForCompletion = false }: { skipWaitForCompletion?: boolean } = {},
  ) {
    await this.getChatInput().click();
    await this.getChatInput().fill(prompt);
    await this.page.getByRole("button", { name: "Send message" }).click();
    if (!skipWaitForCompletion) {
      await this.waitForChatCompletion();
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
