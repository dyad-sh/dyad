import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("should open GitHub import modal from home", async ({ po }) => {
  await po.setUp();

  // Click the "Import from Github" button
  await po.page.getByTestId("import-from-github-button").click();

  // Verify modal opened with connection UI (not authenticated yet)
  await expect(
    po.page.getByRole("heading", { name: "Connect to GitHub" }),
  ).toBeVisible();
  await expect(
    po.page.getByText("Connect your GitHub account to import repositories"),
  ).toBeVisible();
});

test("should connect to GitHub and show import UI", async ({ po }) => {
  await po.setUp();

  // Open modal
  await po.page.getByTestId("import-from-github-button").click();

  // Connect to GitHub (reuse existing connector)
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();

  // Wait for device flow code
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // After connection, modal should show import tabs
  await expect(
    po.page.getByRole("tab", { name: "Your Repositories" }),
  ).toBeVisible();
  await expect(po.page.getByRole("tab", { name: "From URL" })).toBeVisible();
});

test("should import from URL", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByTestId("import-from-github-button").click();
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // Switch to "From URL" tab
  await po.page.getByRole("tab", { name: "From URL" }).click();

  // Enter URL
  await po.page
    .getByPlaceholder("https://github.com/user/repo.git")
    .fill("https://github.com/testuser/existing-app.git");

  // Click import
  await po.page.getByRole("button", { name: "Import", exact: true }).click();

  // Should close modal and navigate to chat
  await expect(
    po.page.getByRole("heading", { name: "Import from GitHub" }),
  ).not.toBeVisible();

  // Verify AI_RULES generation prompt was sent
  await po.snapshotMessages();
});

test("should import from repository list", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByTestId("import-from-github-button").click();
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // Should show repositories list
  await expect(po.page.getByText("testuser/existing-app")).toBeVisible();

  // Click the first Import button in the repo list
  await po.page.getByRole("button", { name: "Import" }).first().click();

  // Should close modal and navigate to chat
  await expect(
    po.page.getByRole("heading", { name: "Import from GitHub" }),
  ).not.toBeVisible();

  // Verify AI_RULES generation prompt
  await po.snapshotMessages();
});

test("should support advanced options with custom commands", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByTestId("import-from-github-button").click();
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // Go to From URL tab
  await po.page.getByRole("tab", { name: "From URL" }).click();
  await po.page
    .getByPlaceholder("https://github.com/user/repo.git")
    .fill("https://github.com/testuser/existing-app.git");

  // Open advanced options
  await po.page.getByRole("button", { name: "Advanced options" }).click();

  // Clear one command - should show error
  await po.page.getByPlaceholder("pnpm install").fill("");
  await expect(
    po.page.getByText("Both commands are required when customizing"),
  ).toBeVisible();
  await expect(
    po.page.getByRole("button", { name: "Import", exact: true }),
  ).toBeDisabled();

  // Fill both commands
  await po.page.getByPlaceholder("pnpm install").fill("npm install");
  await po.page.getByPlaceholder("pnpm dev").fill("npm start");

  await expect(
    po.page.getByRole("button", { name: "Import", exact: true }),
  ).toBeEnabled();
  await expect(
    po.page.getByText("Both commands are required when customizing"),
  ).not.toBeVisible();

  // Import with custom commands
  await po.page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(
    po.page.getByRole("heading", { name: "Import from GitHub" }),
  ).not.toBeVisible();
});

test("should allow empty commands to use defaults", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByTestId("import-from-github-button").click();
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // Go to From URL tab
  await po.page.getByRole("tab", { name: "From URL" }).click();
  await po.page
    .getByPlaceholder("https://github.com/user/repo.git")
    .fill("https://github.com/testuser/existing-app.git");

  // Open advanced options and clear both
  await po.page.getByRole("button", { name: "Advanced options" }).click();
  await po.page.getByPlaceholder("pnpm install").fill("");
  await po.page.getByPlaceholder("pnpm dev").fill("");

  // Should be valid
  await expect(
    po.page.getByRole("button", { name: "Import", exact: true }),
  ).toBeEnabled();

  await po.page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(
    po.page.getByRole("heading", { name: "Import from GitHub" }),
  ).not.toBeVisible();
});
