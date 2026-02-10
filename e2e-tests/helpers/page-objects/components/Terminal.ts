/**
 * Page object for the terminal drawer.
 * Handles terminal opening/closing, command execution, and output validation.
 */

import { Page, expect, Locator } from "@playwright/test";
import { Timeout } from "../../constants";

export class Terminal {
  constructor(public page: Page) {}

  // ================================
  // Locators
  // ================================

  /**
   * Get the terminal toggle button in the action header
   */
  getToggleButton(): Locator {
    return this.page.getByTestId("terminal-toggle-button");
  }

  /**
   * Get the terminal drawer container
   */
  getDrawer(): Locator {
    return this.page.getByTestId("terminal-drawer");
  }

  /**
   * Get the terminal output area
   */
  getOutput(): Locator {
    return this.page.getByTestId("terminal-output");
  }

  /**
   * Get the terminal command input field
   */
  getInput(): Locator {
    return this.page.getByTestId("terminal-input");
  }

  /**
   * Get the new session button
   */
  getNewSessionButton(): Locator {
    return this.page.getByTestId("terminal-new-session-button");
  }

  /**
   * Get the clear terminal button
   */
  getClearButton(): Locator {
    return this.page.getByTestId("terminal-clear-button");
  }

  /**
   * Get the maximize/restore button
   */
  getMaximizeButton(): Locator {
    return this.page.getByTestId("terminal-maximize-button");
  }

  /**
   * Get the close (collapse) button
   */
  getCollapseButton(): Locator {
    return this.page.getByTestId("terminal-collapse-button");
  }

  /**
   * Get the close and end session button
   */
  getCloseButton(): Locator {
    return this.page.getByTestId("terminal-close-button");
  }

  /**
   * Get the session info display (shows cwd)
   */
  getSessionInfo(): Locator {
    return this.page.getByTestId("terminal-session-info");
  }

  /**
   * Get connecting indicator
   */
  getConnectingIndicator(): Locator {
    return this.page.getByTestId("terminal-connecting");
  }

  // ================================
  // Actions
  // ================================

  /**
   * Open the terminal drawer by clicking the toggle button
   */
  async open(): Promise<void> {
    await this.getToggleButton().click();
    await expect(this.getDrawer()).toBeVisible({ timeout: Timeout.MEDIUM });
  }

  /**
   * Close the terminal drawer by clicking the collapse button
   */
  async close(): Promise<void> {
    await this.getCollapseButton().click();
    await expect(this.getDrawer()).not.toBeVisible({ timeout: Timeout.SHORT });
  }

  /**
   * Close the terminal and end the session
   */
  async closeAndEndSession(): Promise<void> {
    await this.getCloseButton().click();
    await expect(this.getDrawer()).not.toBeVisible({ timeout: Timeout.SHORT });
  }

  /**
   * Toggle the terminal open/closed
   */
  async toggle(): Promise<void> {
    await this.getToggleButton().click();
  }

  /**
   * Wait for the terminal session to be ready
   */
  async waitForSession(): Promise<void> {
    // Wait for connecting indicator to disappear
    await expect(this.getConnectingIndicator()).not.toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    // Wait for input to be enabled
    await expect(this.getInput()).toBeEnabled({ timeout: Timeout.MEDIUM });
  }

  /**
   * Type a command in the terminal input
   */
  async typeCommand(command: string): Promise<void> {
    await this.getInput().fill(command);
  }

  /**
   * Execute a command by typing and pressing Enter
   */
  async executeCommand(command: string): Promise<void> {
    await this.typeCommand(command);
    await this.getInput().press("Enter");
  }

  /**
   * Clear the terminal output
   */
  async clear(): Promise<void> {
    await this.getClearButton().click();
  }

  /**
   * Create a new terminal session
   */
  async createNewSession(): Promise<void> {
    await this.getNewSessionButton().click();
    await this.waitForSession();
  }

  /**
   * Maximize the terminal
   */
  async maximize(): Promise<void> {
    await this.getMaximizeButton().click();
  }

  /**
   * Send Ctrl+C to interrupt current command
   */
  async sendInterrupt(): Promise<void> {
    await this.getInput().press("Control+c");
  }

  /**
   * Send Ctrl+L to clear screen
   */
  async sendClearScreen(): Promise<void> {
    await this.getInput().press("Control+l");
  }

  // ================================
  // Assertions
  // ================================

  /**
   * Assert that the terminal drawer is visible
   */
  async expectVisible(): Promise<void> {
    await expect(this.getDrawer()).toBeVisible({ timeout: Timeout.MEDIUM });
  }

  /**
   * Assert that the terminal drawer is not visible
   */
  async expectNotVisible(): Promise<void> {
    await expect(this.getDrawer()).not.toBeVisible({ timeout: Timeout.SHORT });
  }

  /**
   * Assert that the terminal output contains specific text
   */
  async expectOutputContains(
    text: string,
    options?: { timeout?: number },
  ): Promise<void> {
    await expect(this.getOutput()).toContainText(text, {
      timeout: options?.timeout ?? Timeout.MEDIUM,
    });
  }

  /**
   * Assert that the terminal output does not contain specific text
   */
  async expectOutputNotContains(text: string): Promise<void> {
    await expect(this.getOutput()).not.toContainText(text, {
      timeout: Timeout.SHORT,
    });
  }

  /**
   * Assert that the terminal shows the "Terminal ready" message
   */
  async expectReady(): Promise<void> {
    await expect(this.getOutput()).toContainText("Terminal ready", {
      timeout: Timeout.MEDIUM,
    });
  }

  /**
   * Assert that the session has ended
   */
  async expectSessionEnded(): Promise<void> {
    await expect(this.getOutput()).toContainText("[Session ended]", {
      timeout: Timeout.MEDIUM,
    });
  }

  /**
   * Assert that the terminal is in connecting state
   */
  async expectConnecting(): Promise<void> {
    await expect(this.getConnectingIndicator()).toBeVisible({
      timeout: Timeout.SHORT,
    });
  }

  /**
   * Assert that the input is disabled (no active session)
   */
  async expectInputDisabled(): Promise<void> {
    await expect(this.getInput()).toBeDisabled({ timeout: Timeout.SHORT });
  }

  /**
   * Assert that the input is enabled (active session)
   */
  async expectInputEnabled(): Promise<void> {
    await expect(this.getInput()).toBeEnabled({ timeout: Timeout.SHORT });
  }

  /**
   * Get the current text content of the terminal output
   */
  async getOutputText(): Promise<string> {
    return (await this.getOutput().textContent()) ?? "";
  }

  /**
   * Count the number of output lines
   */
  async getOutputLineCount(): Promise<number> {
    const lines = this.getOutput().locator("[data-testid^='terminal-line-']");
    return await lines.count();
  }
}
