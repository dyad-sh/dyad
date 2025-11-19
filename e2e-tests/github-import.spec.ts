import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test("should open GitHub import modal from home", async ({ po }) => {
  await po.setUp();
  // Click the "Import from Github" button
  await po.page.getByRole("button", { name: "Import App" }).click();
  // Verify modal opened with import UI (showing all tabs even when not authenticated)
  await expect(
    po.page.getByRole("heading", { name: "Import App" }),
  ).toBeVisible();
  await expect(
    po.page.getByText(
      "Import existing app from local folder or clone from Github",
    ),
  ).toBeVisible();

  // All tabs should be visible
  await expect(
    po.page.getByRole("tab", { name: "Local Folder" }),
  ).toBeVisible();
  await expect(
    po.page.getByRole("tab", { name: "Your GitHub Repos" }),
  ).toBeVisible();
  await expect(po.page.getByRole("tab", { name: "GitHub URL" })).toBeVisible();
  // Local Folder tab should be active by default
  await expect(
    po.page.getByRole("button", { name: "Select Folder" }),
  ).toBeVisible();
  // Switch to Your GitHub Repos tab - should show GitHub connector
  await po.page.getByRole("tab", { name: "Your GitHub Repos" }).click();
  await expect(
    po.page.getByRole("button", { name: "Connect to GitHub" }),
  ).toBeVisible();
});

test("should connect to GitHub and show import UI", async ({ po }) => {
  await po.setUp();
  // Open modal
  await po.page.getByRole("button", { name: "Import App" }).click();
  // Switch to Your GitHub Repos tab - should show GitHub connector when not authenticated
  await po.page.getByRole("tab", { name: "Your GitHub Repos" }).click();
  // Connect to GitHub (reuse existing connector)
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  // Wait for device flow code
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();
  // After connection, should show repositories list instead of connector
  await expect(po.page.getByText("testuser/existing-app")).toBeVisible();
  // Should be able to see all tabs
  await expect(
    po.page.getByRole("tab", { name: "Your GitHub Repos" }),
  ).toBeVisible();
  await expect(po.page.getByRole("tab", { name: "GitHub URL" })).toBeVisible();
  await expect(
    po.page.getByRole("tab", { name: "Local Folder" }),
  ).toBeVisible();
});

test("should import GitHub URL", async ({ po }) => {
  await po.setUp();
  // Open modal and connect
  await po.page.getByRole("button", { name: "Import App" }).click();
  await po.page.getByRole("tab", { name: "Your GitHub Repos" }).click();
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();
  // Switch to "GitHub URL" tab
  await po.page.getByRole("tab", { name: "GitHub URL" }).click();
  // Enter URL
  await po.page
    .getByPlaceholder("https://github.com/user/repo.git")
    .fill("https://github.com/dyad-sh/nextjs-template.git");

  // Click import
  await po.page.getByRole("button", { name: "Import", exact: true }).click();
  // Should close modal and navigate to chat
  await expect(
    po.page.getByRole("heading", { name: "Import App" }),
  ).not.toBeVisible();
  // Verify AI_RULES generation prompt was sent
});

test("should import from repository list", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByRole("button", { name: "Import App" }).click();
  // Switch to Your GitHub Repos tab - should show GitHub connector when not authenticated
  await po.page.getByRole("tab", { name: "Your GitHub Repos" }).click();
  await po.page.getByRole("button", { name: "Connect to GitHub" }).click();
  await expect(po.page.locator("text=FAKE-CODE")).toBeVisible();

  // Switch to Your GitHub Repos tab
  await po.page.getByRole("tab", { name: "Your GitHub Repos" }).click();

  // Should show repositories list
  await expect(po.page.getByText("testuser/existing-app")).toBeVisible();

  // Click the first Import button in the repo list
  await po.page.getByRole("button", { name: "Import" }).first().click();

  // Should close modal and navigate to chat
  await expect(
    po.page.getByRole("heading", { name: "Import App" }),
  ).not.toBeVisible();

  // Verify AI_RULES generation prompt
  await po.snapshotMessages();
});

test("should support advanced options with custom commands", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByRole("button", { name: "Import App" }).click();
  // Go to GitHub URL tab
  await po.page.getByRole("tab", { name: "GitHub URL" }).click();
  await po.page
    .getByPlaceholder("https://github.com/user/repo.git")
    .fill("https://github.com/dyad-sh/nextjs-template.git");

  // Open advanced options
  await po.page.getByRole("button", { name: "Advanced options" }).click();

  // Fill one command - should show error
  await po.page.getByPlaceholder("pnpm install").fill("npm install");
  await expect(
    po.page.getByText("Both commands are required when customizing"),
  ).toBeVisible();
  await expect(
    po.page.getByRole("button", { name: "Import", exact: true }),
  ).toBeDisabled();

  // Fill both commands
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
    po.page.getByRole("heading", { name: "Import App" }),
  ).not.toBeVisible();
});

test("should allow empty commands to use defaults", async ({ po }) => {
  await po.setUp();

  // Open modal and connect
  await po.page.getByRole("button", { name: "Import App" }).click();

  // Go to GitHub URL tab
  await po.page.getByRole("tab", { name: "GitHub URL" }).click();
  await po.page
    .getByPlaceholder("https://github.com/user/repo.git")
    .fill("https://github.com/dyad-sh/nextjs-template.git");

  // Commands are empty by default, so import should be enabled
  await expect(
    po.page.getByRole("button", { name: "Import", exact: true }),
  ).toBeEnabled();

  await po.page.getByRole("button", { name: "Import", exact: true }).click();

  await expect(
    po.page.getByRole("heading", { name: "Import App" }),
  ).not.toBeVisible();
});
