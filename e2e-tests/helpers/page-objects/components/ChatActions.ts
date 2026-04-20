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
    // Target the Lexical editor directly by placeholder attribute
    // This works for both home and chat input containers
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
    const sendButton = this.page.getByRole("button", {
      name: "Send message",
    });

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
      if (prompt.includes("@app:")) {
        await this.page.keyboard.insertText(prompt);
      } else {
        await this.page.keyboard.type(prompt);
      }
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

    const mapping: Record<string, RegExp> = {
      build: /\bbuild\b/i,
      ask: /\bask\b/i,
      agent: /\bagent\b/i,
      "local-agent": /\b(agent|basic\s+agent)\b/i,
      "basic-agent": /\bbasic\s+agent\b/i,
      plan: /\bplan\b/i,
    };
    const optionName = mapping[mode];

    const normalizeModeText = (value: string) =>
      value.replace(/\s+/g, " ").trim();

    const currentModeText = normalizeModeText(
      (await selector.textContent()) ?? "",
    );
    if (optionName.test(currentModeText)) {
      return;
    }

    const ipcMode =
      mode === "agent" || mode === "basic-agent" ? "local-agent" : mode;
    await this.page.evaluate(async (selectedChatMode) => {
      await (window as any).electron.ipcRenderer.invoke("set-user-settings", {
        selectedChatMode,
      });
    }, ipcMode);

    for (let i = 0; i < 5; i++) {
      const selectedModeText = normalizeModeText(
        (await selector.textContent()) ?? "",
      );
      if (optionName.test(selectedModeText)) {
        return;
      }
      await this.page.waitForTimeout(100);
    }

    const modeAfterIpc = normalizeModeText(
      (await selector.textContent()) ?? "",
    );
    if (optionName.test(modeAfterIpc)) {
      return;
    }

    await expect(async () => {
      for (let i = 0; i < 5; i++) {
        const selectedModeText = normalizeModeText(
          (await selector.textContent()) ?? "",
        );
        if (optionName.test(selectedModeText)) {
          return;
        }

        await selector.focus();
        await this.page.keyboard.press("ControlOrMeta+Period");
        await this.page.waitForTimeout(100);
      }

      const selectedModeText = normalizeModeText(
        (await selector.textContent()) ?? "",
      );
      expect(optionName.test(selectedModeText)).toBe(true);
    }).toPass({ timeout: Timeout.MEDIUM });

    const toggledModeText = normalizeModeText(
      (await selector.textContent()) ?? "",
    );
    if (optionName.test(toggledModeText)) {
      return;
    }

    const orderedModes = ["build", "ask", "local-agent", "plan"] as const;
    const normalizeMode = (value: typeof mode) =>
      value === "agent" || value === "basic-agent" ? "local-agent" : value;
    const currentNormalizedMode =
      (Object.entries(mapping).find(([_, regex]) =>
        regex.test(currentModeText),
      )?.[0] as typeof mode | undefined) ?? undefined;
    const targetNormalizedMode = normalizeMode(mode);

    const currentIndex = currentNormalizedMode
      ? orderedModes.indexOf(normalizeMode(currentNormalizedMode))
      : -1;
    const targetIndex = orderedModes.indexOf(targetNormalizedMode);

    const visiblePopup = this.page.locator(
      '[data-slot="select-content"]:visible',
    );

    await expect(async () => {
      const isExpanded = await selector.getAttribute("aria-expanded");
      if (isExpanded === "true" && (await visiblePopup.count()) === 0) {
        await this.page.keyboard.press("Escape");
      }

      if ((await visiblePopup.count()) === 0) {
        await selector.click({ force: true, timeout: Timeout.SHORT });
      }

      if ((await visiblePopup.count()) === 0) {
        await selector.focus();
        await this.page.keyboard.press("Enter");
      }

      if ((await visiblePopup.count()) === 0) {
        await selector.focus();
        await this.page.keyboard.press("ArrowDown");
      }

      expect(await visiblePopup.count()).toBeGreaterThan(0);
    }).toPass({ timeout: Timeout.MEDIUM });

    if (currentIndex >= 0 && targetIndex >= 0) {
      const steps =
        (targetIndex - currentIndex + orderedModes.length) %
        orderedModes.length;
      for (let i = 0; i < steps; i++) {
        await this.page.keyboard.press("ArrowDown");
        await this.page.waitForTimeout(100);
      }
      await this.page.keyboard.press("Enter");

      const selectedModeText = normalizeModeText(
        (await selector.textContent()) ?? "",
      );
      if (optionName.test(selectedModeText)) {
        await this.page.keyboard.press("Escape");
        return;
      }
    }

    const roleOption = visiblePopup.getByRole("option", {
      name: optionName,
    });
    const fallbackOption = visiblePopup
      .locator('[data-slot="select-item"]')
      .filter({ hasText: optionName });
    const option = roleOption.or(fallbackOption).first();

    await expect(option).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(async () => {
      try {
        await option.click({ timeout: Timeout.SHORT });
      } catch {
        try {
          await option.click({ force: true, timeout: Timeout.SHORT });
        } catch {
          await option.dispatchEvent("click");
        }
      }

      const selectedModeText = normalizeModeText(
        (await selector.textContent()) ?? "",
      );
      expect(optionName.test(selectedModeText)).toBe(true);
    }).toPass({ timeout: Timeout.MEDIUM });

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
