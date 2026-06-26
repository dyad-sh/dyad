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
      '[data-testid="chat-input-container"]:visible [data-lexical-editor="true"][aria-placeholder^="Ask Dyad to build"], [data-testid="home-chat-input-container"]:visible [data-lexical-editor="true"][aria-placeholder^="Ask Dyad to build"]',
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
    const visibleNewChatButtons = this.page.locator(
      '[data-testid="new-chat-button"]:visible',
    );

    await expect(async () => {
      const visibleCount = await visibleNewChatButtons.count();
      if (visibleCount <= index) {
        await this.page.getByRole("link", { name: "Apps" }).hover();
        await expect(this.page.getByTestId("chat-list-container")).toBeVisible({
          timeout: 1_000,
        });
      }
      await expect(visibleNewChatButtons.nth(index)).toBeVisible({
        timeout: 1_000,
      });
      await visibleNewChatButtons.nth(index).click({ timeout: 1_000 });
    }).toPass({ timeout: Timeout.MEDIUM });

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

  private async getCurrentChatCompletionCheckpoint() {
    const chatId = Number(new URL(this.page.url()).searchParams.get("id"));
    if (!chatId) {
      return null;
    }
    const messageCount = await this.page
      .evaluate(async (currentChatId) => {
        const chat = await (window as any).electron.ipcRenderer.invoke(
          "get-chat",
          currentChatId,
        );
        return chat.messages.length;
      }, chatId)
      .catch(() => null);
    if (messageCount === null) {
      return null;
    }
    return { chatId, messageCount };
  }

  private getUndoButton() {
    return this.page.getByRole("button", { name: "Undo" });
  }

  async waitForChatCompletion({
    timeout = Timeout.MEDIUM,
    checkpoint,
  }: {
    timeout?: number;
    checkpoint?: { chatId: number; messageCount: number } | null;
  } = {}) {
    if (checkpoint) {
      await expect(async () => {
        const chat = await this.page.evaluate(async (chatId) => {
          return (window as any).electron.ipcRenderer.invoke(
            "get-chat",
            chatId,
          );
        }, checkpoint.chatId);
        expect(chat.messages.length).toBeGreaterThanOrEqual(
          checkpoint.messageCount + 2,
        );
        const lastMessage = chat.messages.at(-1);
        expect(lastMessage?.role).toBe("assistant");
        expect(lastMessage?.content.trim().length).toBeGreaterThan(0);
      }).toPass({ timeout });
      return;
    }

    await expect(this.getRetryButton()).toBeVisible({
      timeout,
    });
  }

  async clickRetry() {
    await this.getRetryButton().click();
  }

  async clickUndo() {
    const undoButton = this.getUndoButton().last();
    await expect(undoButton).toBeEnabled({ timeout: Timeout.MEDIUM });
    await undoButton.click();

    await expect(undoButton)
      .toBeDisabled({ timeout: 1_000 })
      .catch(() => {
        // The operation may finish before Playwright observes the disabled
        // state. The enabled/hidden wait below is the completion signal.
      });
    await expect(async () => {
      const buttons = this.getUndoButton();
      if ((await buttons.count()) === 0) {
        return;
      }
      await expect(buttons.last()).toBeEnabled({ timeout: 1_000 });
    }).toPass({ timeout: Timeout.MEDIUM });
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
    const sendButton = this.page
      .locator(
        '[data-testid="chat-input-container"]:visible, [data-testid="home-chat-input-container"]:visible',
      )
      .getByRole("button", { name: "Send message" });
    const completionCheckpoint =
      await this.getCurrentChatCompletionCheckpoint();

    await expect(chatInput).toBeVisible();
    await expect(async () => {
      await chatInput.evaluate((element) => {
        (element as HTMLElement).focus();
      });
      await chatInput.fill(prompt, { timeout: 1_000 });
      const visiblePrompt = prompt.replace(/@app:/g, "@");
      expect(await chatInput.textContent({ timeout: 1_000 })).toContain(
        visiblePrompt,
      );
      await this.page.waitForTimeout(100);
      expect(await chatInput.textContent({ timeout: 1_000 })).toContain(
        visiblePrompt,
      );
      await expect(sendButton).toBeEnabled({ timeout: 1_000 });
      try {
        await sendButton.click({ timeout: 1_000 });
      } catch (error) {
        await expect(async () => {
          const promptSubmitted = await this.page
            .getByTestId("messages-list")
            .getByText(visiblePrompt)
            .last()
            .isVisible({ timeout: 500 })
            .catch(() => false);
          const generationStarted = await this.page
            .getByRole("button", { name: "Cancel generation" })
            .isVisible({ timeout: 500 })
            .catch(() => false);
          const inputText = await chatInput
            .textContent({ timeout: 500 })
            .catch(() => "");

          expect(
            promptSubmitted || (generationStarted && !inputText?.trim()),
          ).toBe(true);
        })
          .toPass({ timeout: Timeout.SHORT })
          .catch(() => {
            throw error;
          });
      }
    }).toPass({ timeout: Timeout.MEDIUM });

    if (!skipWaitForCompletion) {
      await this.waitForChatCompletion({
        timeout,
        checkpoint: completionCheckpoint,
      });
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
