import { expect, type Page } from "@playwright/test";
import { Timeout } from "../../constants";
import type { GitHubConnector } from "./GitHubConnector";

export class DeployDialog {
  constructor(
    private page: Page,
    private githubConnector: GitHubConnector,
  ) {}

  get dialog() {
    return this.page.getByRole("dialog", { name: /^Deploy / });
  }

  button(name: string) {
    return this.dialog.getByRole("button", { name, exact: true });
  }

  get planning() {
    return this.dialog.getByText("Computing migration plan...");
  }

  get migrationSql() {
    return this.dialog.getByText('DROP TABLE "mock_legacy"');
  }

  get migrationError() {
    return this.dialog.getByText("Couldn't compute migration plan.");
  }

  get vercelSyncPreview() {
    return this.dialog.getByTestId("vercel-sync-preview");
  }

  get vercelBuilding() {
    return this.dialog.getByText("Building on Vercel…");
  }

  async open() {
    await this.page.getByTestId("deploy-button").click();
    await expect(this.dialog).toBeVisible();
  }

  async expectStep(number: number, name: string) {
    await expect(
      this.dialog.getByRole("heading", { name: `Step ${number} — ${name}` }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  }

  async selectDatabase(branch: "production" | "development") {
    await this.button(
      branch === "production" ? "Production database" : "Development database",
    ).click();
  }

  async approveMigration() {
    await expect(this.migrationSql).toBeVisible({ timeout: Timeout.MEDIUM });
    await this.button("I understand, continue").click();
    await expect(
      this.dialog.getByText(/This will modify the main schema in Test Project/),
    ).toBeVisible();
    await this.button("I understand, migrate to production").click();
  }

  async expectMigrationApplied() {
    await expect(
      this.dialog.getByText(
        "Migration applied successfully. You can continue.",
      ),
    ).toBeVisible();
  }

  async continueToDeployment(repo: string) {
    await this.button("Continue to GitHub").click();
    await this.expectStep(2, "GitHub repository");
    await expect(this.button("Continue to deployment")).toBeDisabled();
    await this.githubConnector.connect();
    await this.githubConnector.createRepo(repo);
    await expect(this.button("Continue to deployment")).toBeEnabled();
    await this.button("Continue to deployment").click();
    await this.expectStep(3, "Deployment");
  }

  async publishToCloudflare(repo: string) {
    await this.continueToDeployment(repo);
    await this.button("Cloudflare").click();
    await this.dialog
      .getByLabel("Cloudflare API Token")
      .fill("fake-cloudflare-token");
    await this.button("Save API Token").click();
    await expect(this.dialog.getByTestId("cloudflare-worker-name")).toHaveValue(
      "guided-worker",
      { timeout: Timeout.MEDIUM },
    );
    await expect(this.button("Finish")).toBeHidden();
    await this.button("Connect and Deploy").click();
    await expect(
      this.dialog.getByText("Cloudflare deployment verified."),
    ).toBeVisible({ timeout: Timeout.LONG });
    // Neon setup is handled by the connector; the wizard must not ask users
    // to repeat it manually after deployment succeeds.
    await expect(
      this.dialog.getByText(
        /Configure your required environment variables in Cloudflare/,
      ),
    ).toBeHidden();
    await this.finish();
  }

  async connectToVercel() {
    await this.button("Vercel").click();
    await this.dialog
      .getByPlaceholder("Enter your Vercel access token")
      .fill("fake-vercel-token");
    await this.button("Save Access Token").click();
    await expect(this.dialog.getByTestId("vercel-setup-project")).toBeVisible();
  }

  async enterVercelProjectName(name: string) {
    await this.dialog
      .getByTestId("vercel-create-project-name-input")
      .fill(name);
    await expect(
      this.dialog.getByText("Project name is available!"),
    ).toBeVisible();
  }

  async createVercelProject(name: string) {
    await this.button("Create Project").click();
    await expect(
      this.dialog.getByTestId("vercel-connected-project"),
    ).toContainText(name);
  }

  async expectGitHubPushVerified() {
    await expect(
      this.dialog.getByText(/Latest code verified on GitHub/),
    ).toBeVisible({ timeout: Timeout.LONG });
  }

  async finish() {
    await this.button("Finish").click();
    await expect(this.dialog).toBeHidden();
  }
}
