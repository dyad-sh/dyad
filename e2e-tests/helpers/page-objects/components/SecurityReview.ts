/**
 * Page object for security review functionality.
 * Handles running security reviews and managing findings.
 */

import { Page, expect } from "@playwright/test";
import { ChatActions } from "./ChatActions";

export class SecurityReview {
  private chatActions: ChatActions;

  constructor(public page: Page) {
    this.chatActions = new ChatActions(page);
  }

  async clickRunSecurityReview() {
    const runSecurityReviewButton = this.page
      .getByRole("button", { name: "Run Security Review" })
      .first();
    await runSecurityReviewButton.click();
    // Wait for the "Running Security Review..." button to appear and then disappear
    // This indicates the security review has completed
    const runningButton = this.page.getByRole("button", {
      name: "Running Security Review...",
    });
    await runningButton.waitFor({ state: "visible" });
    await runningButton.waitFor({ state: "hidden" });
    await this.chatActions.waitForChatCompletion();
  }

  async snapshotSecurityFindingsTable() {
    await expect(
      this.page.getByTestId("security-findings-table"),
    ).toMatchAriaSnapshot();
  }
}
