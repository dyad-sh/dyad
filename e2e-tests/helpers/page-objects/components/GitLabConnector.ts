/**
 * Page object for GitLab publishing.
 *
 * Drives the credentials form and the link form in the Publish panel, and
 * the fake GitLab server's test API for deterministic assertions. The
 * connected view is the one GitHub uses, so its test ids are shared.
 */

import { expect, Page } from "@playwright/test";
import { Timeout } from "../../constants";

export const FAKE_GITLAB_TOKEN = "glpat-fake-token";

export class GitLabConnector {
  constructor(
    public page: Page,
    public fakeLlmPort: number,
  ) {}

  instanceUrl() {
    return `http://localhost:${this.fakeLlmPort}/gitlab`;
  }

  /** Picks GitLab in the Repository card of an unlinked app. */
  async chooseProvider() {
    await this.page.getByTestId("repository-provider-gitlab").click();
  }

  /** Types the fake instance's address and token, as a user would their own. */
  async connect() {
    await this.page
      .getByTestId("gitlab-instance-url-input")
      .fill(this.instanceUrl());
    await this.page.getByTestId("gitlab-token-input").fill(FAKE_GITLAB_TOKEN);
    await this.page.getByTestId("gitlab-connect-button").click();
    await expect(this.getSetupRepo()).toBeVisible({ timeout: Timeout.MEDIUM });
  }

  getSetupRepo() {
    return this.page.getByTestId("gitlab-setup-repo");
  }

  getConnectedRepo() {
    return this.page.getByTestId("github-connected-repo");
  }

  async createProject(name: string, namespace = "dyad-team", branch = "main") {
    await expect(this.getSetupRepo()).toBeVisible({ timeout: Timeout.MEDIUM });
    await this.page.getByTestId("gitlab-namespace-select").click();
    await this.page.getByRole("option", { name: namespace }).click();
    await this.page.getByTestId("gitlab-create-project-name-input").fill(name);
    await expect(this.page.getByText("Project name is available!")).toBeVisible(
      { timeout: Timeout.MEDIUM },
    );
    if (branch !== "main") {
      await this.page
        .getByTestId("gitlab-new-project-branch-input")
        .fill(branch);
    }
    await this.page.getByRole("button", { name: "Create Project" }).click();
    await this.waitForSyncToFinish();
  }

  async connectExistingProject(pathWithNamespace: string, branch: string) {
    // Disconnect remounts the setup card collapsed; clicking the header is a
    // no-op when already expanded.
    await this.page
      .getByRole("button", { name: "Set up your GitLab project" })
      .click();
    await this.page
      .getByRole("button", { name: "Connect to existing project" })
      .click();
    await this.page.getByTestId("gitlab-project-select").click();
    await this.page.getByRole("option", { name: pathWithNamespace }).click();
    await this.page.getByTestId("gitlab-branch-select").click();
    await this.page.getByRole("option", { name: branch, exact: true }).click();
    await this.page.getByRole("button", { name: "Connect to Project" }).click();
    await this.waitForSyncToFinish();
  }

  async sync() {
    await this.page.getByRole("button", { name: "Sync to GitLab" }).click();
    await this.waitForSyncToFinish();
  }

  async disconnectRepo() {
    await this.page
      .getByRole("button", { name: "Disconnect from repo" })
      .click();
    await expect(this.getSetupRepo()).toBeVisible({ timeout: Timeout.MEDIUM });
  }

  async waitForSyncToFinish() {
    const connected = this.getConnectedRepo();
    await expect(connected).toBeVisible({ timeout: Timeout.LONG });
    await expect(
      connected.getByText("Successfully pushed to GitLab!"),
    ).toBeVisible({ timeout: Timeout.LONG });
    await expect(
      connected.getByRole("button", { name: "Sync to GitLab" }),
    ).toBeEnabled({ timeout: Timeout.LONG });
  }

  async reset() {
    const response = await this.page.request.post(
      `http://localhost:${this.fakeLlmPort}/gitlab/test/reset`,
    );
    return await response.json();
  }

  async getPushEvents(pathWithNamespace?: string) {
    const suffix = pathWithNamespace
      ? `?path=${encodeURIComponent(pathWithNamespace)}`
      : "";
    const response = await this.page.request.get(
      `http://localhost:${this.fakeLlmPort}/gitlab/test/push-events${suffix}`,
    );
    return (await response.json()) as Array<{
      path: string;
      branch: string;
      operation: "push" | "create" | "delete";
    }>;
  }

  async expectPushEvent(expected: {
    path: string;
    branch: string;
    operation: "push" | "create" | "delete";
  }) {
    await expect
      .poll(
        async () => {
          const events = await this.getPushEvents(expected.path);
          return events.some(
            (event) =>
              event.branch === expected.branch &&
              event.operation === expected.operation,
          );
        },
        { timeout: Timeout.MEDIUM },
      )
      .toBe(true);
  }

  async getDeployKeys() {
    const response = await this.page.request.get(
      `http://localhost:${this.fakeLlmPort}/gitlab/test/deploy-keys`,
    );
    return (await response.json()) as Array<{
      project: string;
      title: string;
      key: string;
      can_push: boolean;
    }>;
  }
}
