import { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Page object for Vercel connector interactions and testing.
 */
export class VercelConnector {
  constructor(public page: Page) {}

  /**
   * Set a soft block on the mock Vercel account (for testing account warnings).
   */
  async setSoftBlock(
    reason: string,
    blockedDueToOverageType?: string,
  ): Promise<void> {
    const response = await this.page.request.post(
      "http://localhost:3500/vercel/api/test/set-soft-block",
      {
        data: { reason, blockedDueToOverageType },
      },
    );
    if (!response.ok()) {
      throw new Error(`Failed to set soft block: ${await response.text()}`);
    }
  }

  /**
   * Clear the soft block on the mock Vercel account.
   */
  async clearSoftBlock(): Promise<void> {
    const response = await this.page.request.post(
      "http://localhost:3500/vercel/api/test/clear-soft-block",
    );
    if (!response.ok()) {
      throw new Error(`Failed to clear soft block: ${await response.text()}`);
    }
  }

  /**
   * Get the current soft block state.
   */
  async getSoftBlock(): Promise<{
    softBlock: {
      blockedAt: number;
      reason: string;
      blockedDueToOverageType?: string;
    } | null;
  }> {
    const response = await this.page.request.get(
      "http://localhost:3500/vercel/api/test/soft-block",
    );
    return await response.json();
  }

  /**
   * Get the account warning element.
   */
  getAccountWarning() {
    return this.page.getByTestId("vercel-account-warning");
  }

  /**
   * Check if the account warning is visible.
   */
  async isAccountWarningVisible(): Promise<boolean> {
    const warning = this.getAccountWarning();
    return await warning.isVisible();
  }

  /**
   * Snapshot the connected Vercel project state.
   */
  async snapshotConnectedProject() {
    await expect(
      this.page.getByTestId("vercel-connected-project"),
    ).toMatchAriaSnapshot();
  }
}
