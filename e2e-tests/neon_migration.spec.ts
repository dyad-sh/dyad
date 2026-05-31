import { expect } from "@playwright/test";
import { testSkipIfWindows, Timeout } from "./helpers/test_helper";

testSkipIfWindows("neon migration push from publish panel", async ({ po }) => {
  await po.setUp({ autoApprove: true });
  await po.navigation.goToHubAndSelectTemplate("Next.js Template");
  await po.chatActions.selectChatMode("build");
  await po.sendPrompt("tc=basic", { timeout: Timeout.EXTRA_LONG });
  await po.sendPrompt("tc=add-neon");

  // Connect to Neon with a non-default branch so migration is allowed
  await po.appManagement.startDatabaseIntegrationSetup("neon");
  await po.appManagement.clickConnectNeonButton();
  await po.appManagement.selectNeonProject("Test Project");

  // Navigate back to chat, then to the publish panel
  await po.navigation.clickBackButton();
  await po.previewPanel.selectPreviewMode("publish");

  // The app is on the development branch, so the unified Database section shows
  // a picker. Choosing Production reveals the migration panel.
  const databaseSection = po.page.getByTestId("database-section");
  await expect(databaseSection).toBeVisible({ timeout: Timeout.MEDIUM });
  await databaseSection.getByRole("button", { name: /^Production/ }).click();
  await databaseSection.getByRole("button", { name: "Continue" }).click();

  // Verify the migration panel is visible
  const migrateButton = po.page.getByRole("button", {
    name: "Migrate to Production",
  });
  await expect(migrateButton).toBeVisible({ timeout: Timeout.MEDIUM });

  // Click the migrate button
  await migrateButton.click();

  // Approve the SQL preview dialog before reaching the confirm dialog
  await expect(
    po.page.getByRole("heading", { name: "Review migration SQL" }),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(po.page.getByText("Destructive changes detected")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(po.page.getByText("A table will be dropped.")).toBeVisible({
    timeout: Timeout.MEDIUM,
  });
  await expect(
    po.page.getByText(
      "This statement includes a database hazard such as a permission, lock, dependency, or data-safety risk.",
    ),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page.getByRole("button", { name: "I understand, continue" }).click();

  await expect(
    po.page.getByText(
      "This will modify the main schema in Test Project using the schema from development.",
    ),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await expect(
    po.page.getByText(
      "This migration includes destructive changes that may result in data loss.",
    ),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page
    .getByRole("button", { name: "I understand, migrate to production" })
    .last()
    .click();

  // Verify success message appears
  await expect(
    po.page.getByText("Migration applied successfully."),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});

testSkipIfWindows(
  "neon migration is skipped on the production branch",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.navigation.goToHubAndSelectTemplate("Next.js Template");
    await po.chatActions.selectChatMode("build");
    await po.sendPrompt("tc=basic", { timeout: Timeout.EXTRA_LONG });
    await po.sendPrompt("tc=add-neon");

    await po.appManagement.startDatabaseIntegrationSetup("neon");
    await po.appManagement.clickConnectNeonButton();
    await po.appManagement.selectNeonProject("Test Project");
    await po.appManagement.selectNeonBranch("main");

    await po.navigation.clickBackButton();
    await po.previewPanel.selectPreviewMode("publish");

    // On the production branch (Case 2) there is no branch picker and no
    // migration step — just an explanatory message plus the env vars section.
    const databaseSection = po.page.getByTestId("database-section");
    await expect(databaseSection).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      databaseSection.getByText("Your app is on the production branch", {
        exact: false,
      }),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      po.page.getByRole("button", { name: "Migrate to Production" }),
    ).toHaveCount(0);

    // The env vars section is still available for the production branch.
    await databaseSection
      .getByRole("button", { name: "Environment variables" })
      .click();
    await expect(databaseSection.getByLabel("DATABASE_URL")).toHaveValue(
      "postgresql://test:test@test-main.neon.tech/test",
      { timeout: Timeout.MEDIUM },
    );
  },
);
