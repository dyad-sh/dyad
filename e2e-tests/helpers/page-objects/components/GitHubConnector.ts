/**
 * Page object for GitHub integration testing.
 * The UI-driving helpers were removed when the GitHub connector e2e coverage
 * migrated to the hybrid harness; what remains talks to the fake GitHub
 * server's test API so PageObject.setUp can reset state between tests.
 */

import { Page } from "@playwright/test";

export class GitHubConnector {
  constructor(
    public page: Page,
    public fakeLlmPort: number,
  ) {}

  async clearPushEvents() {
    const response = await this.page.request.post(
      `http://localhost:${this.fakeLlmPort}/github/api/test/clear-push-events`,
    );
    return await response.json();
  }

  async resetRepos() {
    const response = await this.page.request.post(
      `http://localhost:${this.fakeLlmPort}/github/api/test/reset-repos`,
    );
    return await response.json();
  }
}
