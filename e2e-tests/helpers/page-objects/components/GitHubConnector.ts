/**
 * Page object for GitHub integration testing.
 * Handles the primary user-facing connection and repository setup flows, plus
 * the fake GitHub server's test API used for deterministic assertions.
 */

import { expect, Page } from "@playwright/test";
import { Timeout } from "../../constants";

export class GitHubConnector {
  constructor(
    public page: Page,
    public fakeLlmPort: number,
  ) {}

  async connect() {
    await this.page.getByRole("button", { name: "Connect to GitHub" }).click();
    await expect(this.page.getByText("FAKE-CODE")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(
      this.page.getByText("https://github.com/login/device"),
    ).toBeVisible();
  }

  getSetupRepo() {
    return this.page.getByTestId("github-setup-repo");
  }

  async createRepo(name: string, branch = "main") {
    await expect(this.getSetupRepo()).toBeVisible({ timeout: Timeout.MEDIUM });
    await this.page.getByTestId("github-create-repo-name-input").fill(name);
    await expect(
      this.page.getByText("Repository name is available!"),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    if (branch !== "main") {
      await this.page.getByTestId("github-new-repo-branch-input").fill(branch);
    }
    await this.page.getByRole("button", { name: "Create Repo" }).click();
    await this.waitForSyncToFinish();
  }

  async connectExistingRepo(repo: string, branch: string) {
    // Disconnect remounts the setup card collapsed. Clicking the header is a
    // no-op when already expanded and otherwise lets its transition complete
    // before Playwright targets the mode button underneath it.
    await this.page
      .getByRole("button", { name: "Set up your GitHub repo" })
      .click();
    await this.page
      .getByRole("button", { name: "Connect to existing repo" })
      .click();
    await this.page.getByTestId("github-repo-select").click();
    await this.page.getByRole("option", { name: repo }).click();
    await this.page.getByTestId("github-branch-select").click();
    await this.page.getByRole("option", { name: branch }).click();
    await this.page.getByRole("button", { name: "Connect to Repo" }).click();
    await this.waitForSyncToFinish();
  }

  async sync() {
    await this.page.getByRole("button", { name: "Sync to GitHub" }).click();
    await this.waitForSyncToFinish();
  }

  async disconnectRepo() {
    await this.page
      .getByRole("button", { name: "Disconnect from repo" })
      .click();
    await expect(this.getSetupRepo()).toBeVisible({ timeout: Timeout.MEDIUM });
  }

  async waitForSyncToFinish() {
    const connectedRepo = this.page.getByTestId("github-connected-repo");
    await expect(connectedRepo).toBeVisible({ timeout: Timeout.LONG });
    await expect(
      connectedRepo.getByText("Successfully pushed to GitHub!"),
    ).toBeVisible({ timeout: Timeout.LONG });
    await expect(
      connectedRepo.getByRole("button", { name: "Sync to GitHub" }),
    ).toBeEnabled({ timeout: Timeout.LONG });
  }

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

  async getPushEvents(repo?: string) {
    const suffix = repo ? `?repo=${encodeURIComponent(repo)}` : "";
    const response = await this.page.request.get(
      `http://localhost:${this.fakeLlmPort}/github/api/test/push-events${suffix}`,
    );
    return (await response.json()) as Array<{
      repo: string;
      branch: string;
      operation: "push" | "create" | "delete";
    }>;
  }

  async expectPushEvent(expected: {
    repo: string;
    branch: string;
    operation: "push" | "create" | "delete";
  }) {
    await expect
      .poll(
        async () => {
          const events = await this.getPushEvents(expected.repo);
          return events.some(
            (event) =>
              event.repo === expected.repo &&
              event.branch === expected.branch &&
              event.operation === expected.operation,
          );
        },
        { timeout: Timeout.MEDIUM },
      )
      .toBe(true);
  }
}
