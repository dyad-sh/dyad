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
    let previousChatId = new URL(this.page.url()).searchParams.get("id");
    if (previousChatId === null) {
      // Importing an app creates and navigates to its initial chat
      // asynchronously. Do not let that pending navigation masquerade as the
      // receipt for this New Chat click.
      await expect(() => {
        previousChatId = new URL(this.page.url()).searchParams.get("id");
        expect(previousChatId).not.toBeNull();
      }).toPass({ timeout: Timeout.MEDIUM });
    }
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
      try {
        await visibleNewChatButtons.nth(index).click({ timeout: 1_000 });
      } catch (error) {
        // The click can be dispatched successfully and then reject because the
        // navigation replaces its target. Retrying that click creates a second
        // chat, so treat a changed route as the receipt for the first click.
        const navigationCompleted = await expect(() => {
          const currentChatId = new URL(this.page.url()).searchParams.get("id");
          expect(currentChatId).not.toBe(previousChatId);
        })
          .toPass({ timeout: 1_000 })
          .then(() => true)
          .catch(() => false);
        if (!navigationCompleted) {
          throw error;
        }
      }
    }).toPass({ timeout: Timeout.MEDIUM });

    await expect(async () => {
      const currentChatId = new URL(this.page.url()).searchParams.get("id");
      expect(currentChatId).not.toBe(previousChatId);

      const chatInput = this.getChatInput();
      await expect(chatInput).toBeVisible({ timeout: 1_000 });
      const text = await chatInput.textContent({ timeout: 1_000 });
      expect(text?.trim() ?? "").toBe("");

      // Prompt admission and per-chat input state use the selected-chat atom,
      // so wait for the matching tab to become active before returning.
      const currentChatTab = this.page.getByTestId(`chat-tab-${currentChatId}`);
      const tabButton = currentChatTab.locator('button[aria-current="page"]');
      if (!(await tabButton.isVisible().catch(() => false))) {
        await currentChatTab
          .locator("button")
          .first()
          .click({ timeout: 1_000 });
      }
      await expect(tabButton).toBeVisible({ timeout: 1_000 });
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
    const trigger = this.page.getByTestId("chat-mode-selector");
    const mapping: Record<string, string> = {
      build: "Build Generate and edit code",
      ask: "Ask Ask",
      agent: "Build with MCP",
      "local-agent": "Agent v2",
      "basic-agent": "Basic Agent", // For free users
      plan: "Plan.*Design before you build",
    };
    const optionName = mapping[mode];
    const selectedName: Record<string, RegExp> = {
      build: /Chat mode: Build/,
      ask: /Chat mode: Ask/,
      agent: /Chat mode: Build/,
      "local-agent": /Chat mode: Agent/,
      "basic-agent": /Chat mode: Basic Agent/,
      plan: /Chat mode: Plan/,
    };
    const storedMode = mode === "basic-agent" ? "local-agent" : mode;

    await expect(async () => {
      const selectedMode = await trigger.getAttribute("aria-label");
      if (!selectedName[mode].test(selectedMode ?? "")) {
        await trigger.click({ timeout: 1_000 });
        await this.page
          .getByRole("option", { name: new RegExp(optionName) })
          .click({ timeout: 1_000 });
      }

      await expect(trigger).toHaveAttribute("aria-label", selectedName[mode], {
        timeout: 1_000,
      });
      const chatId = Number(new URL(this.page.url()).searchParams.get("id"));
      if (Number.isInteger(chatId) && chatId > 0 && mode !== "agent") {
        const persistedMode = await this.page.evaluate(
          async ({ id }) => {
            const chat = await (window as any).electron.ipcRenderer.invoke(
              "get-chat",
              id,
            );
            return chat.chatMode;
          },
          { id: chatId },
        );
        expect(persistedMode).toBe(storedMode);
      }
      await this.page.waitForTimeout(100);
      await expect(trigger).toHaveAttribute("aria-label", selectedName[mode], {
        timeout: 1_000,
      });
    }).toPass({ timeout: Timeout.MEDIUM });
  }

  async selectLocalAgentMode() {
    await this.selectChatMode("local-agent");
  }

  async snapshotChatInputContainer() {
    await expect(this.getChatInputContainer()).toMatchAriaSnapshot();
  }
}
