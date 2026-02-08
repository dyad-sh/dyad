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
    await runSecurityReviewButton.waitFor({ state: "hidden" });
    await this.chatActions.waitForChatCompletion();
  }

  async snapshotSecurityFindingsTable() {
    await expect(
      this.page.getByTestId("security-findings-table"),
    ).toMatchAriaSnapshot();
  }
}
