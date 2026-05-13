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

  // Verify the MigrationPanel is visible
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
  await po.page.getByRole("button", { name: "Continue" }).click();

  await expect(
    po.page.getByText(
      "This will modify the main schema in Test Project using the schema from development.",
    ),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
  await po.page
    .getByRole("button", { name: "Migrate to Production" })
    .last()
    .click();

  // Verify success message appears
  await expect(
    po.page.getByText("Migration applied successfully."),
  ).toBeVisible({ timeout: Timeout.MEDIUM });
});

testSkipIfWindows(
  "neon migration stays disabled on the production branch",
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

    const migrateButton = po.page.getByRole("button", {
      name: "Migrate to Production",
    });
    await expect(migrateButton).toBeDisabled({ timeout: Timeout.MEDIUM });
    await expect(
      po.page.getByText(
        "Switch to a non-production branch in the Neon panel before migrating.",
      ),
    ).toBeVisible({ timeout: Timeout.MEDIUM });
  },
);
