/**
 * Page object for GitHub integration testing.
 * Handles connecting, creating/syncing repos, and verifying push events.
 */

import { Page, expect } from "@playwright/test";

export class GitHubConnector {
  constructor(
    public page: Page,
    public fakeLlmPort: number,
  ) {}

  async connect() {
    await this.page.getByRole("button", { name: "Connect to GitHub" }).click();
  }

  getSetupYourGitHubRepoButton() {
    return this.page.getByText("Set up your GitHub repo");
  }

  getCreateNewRepoModeButton() {
    return this.page.getByRole("button", { name: "Create new repo" });
  }

  getConnectToExistingRepoModeButton() {
    return this.page.getByRole("button", { name: "Connect to existing repo" });
  }

  async clickCreateRepoButton() {
    await this.page.getByRole("button", { name: "Create Repo" }).click();
  }

  async fillCreateRepoName(name: string) {
    await this.page.getByTestId("github-create-repo-name-input").fill(name);
  }

  async selectOrg(org: string) {
    await this.page.getByTestId("github-org-select").click();
    await this.page.getByRole("option", { name: org }).click();
  }

  async fillNewRepoBranchName(name: string) {
    await this.page.getByTestId("github-new-repo-branch-input").fill(name);
  }

  async selectRepo(repo: string) {
    await this.page.getByTestId("github-repo-select").click();
    await this.page.getByRole("option", { name: repo }).click();
  }

  async selectBranch(branch: string) {
    await this.page.getByTestId("github-branch-select").click();
    await this.page.getByRole("option", { name: branch }).click();
  }

  async selectCustomBranch(branch: string) {
    await this.page.getByTestId("github-branch-select").click();
    await this.page
      .getByRole("option", { name: "✏️ Type custom branch name" })
      .click();
    await this.page.getByTestId("github-custom-branch-input").click();
    await this.page.getByTestId("github-custom-branch-input").fill(branch);
  }

  async clickConnectToRepoButton() {
    await this.page.getByRole("button", { name: "Connect to repo" }).click();
  }

  async snapshotConnectedRepo() {
    await expect(
      this.page.getByTestId("github-connected-repo"),
    ).toMatchAriaSnapshot();
  }

  async snapshotSetupRepo() {
    await expect(
      this.page.getByTestId("github-setup-repo"),
    ).toMatchAriaSnapshot();
  }

  async snapshotUnconnectedRepo() {
    await expect(
      this.page.getByTestId("github-unconnected-repo"),
    ).toMatchAriaSnapshot();
  }

  async clickSyncToGithubButton() {
    await this.page.getByRole("button", { name: "Sync to GitHub" }).click();
  }

  async clickDisconnectRepoButton() {
    await this.page
      .getByRole("button", { name: "Disconnect from repo" })
      .click();
  }

  async clearPushEvents() {
    const response = await this.page.request.post(
      `http://localhost:${this.fakeLlmPort}/github/api/test/clear-push-events`,
    );
    return await response.json();
  }

  async getPushEvents(repo?: string) {
    const url = repo
      ? `http://localhost:${this.fakeLlmPort}/github/api/test/push-events?repo=${repo}`
      : `http://localhost:${this.fakeLlmPort}/github/api/test/push-events`;
    const response = await this.page.request.get(url);
    return await response.json();
  }

  async verifyPushEvent(expectedEvent: {
    repo: string;
    branch: string;
    operation?: "push" | "create" | "delete";
  }) {
    const pushEvents = await this.getPushEvents(expectedEvent.repo);
    const matchingEvent = pushEvents.find(
      (event: any) =>
        event.repo === expectedEvent.repo &&
        event.branch === expectedEvent.branch &&
        (!expectedEvent.operation ||
          event.operation === expectedEvent.operation),
    );

    if (!matchingEvent) {
      throw new Error(
        `Expected push event not found. Expected: ${JSON.stringify(expectedEvent)}. ` +
          `Actual events: ${JSON.stringify(pushEvents)}`,
      );
    }

    return matchingEvent;
  }
}
