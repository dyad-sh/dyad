import { expect } from "@playwright/test";
import { FakeVercel } from "./helpers/fake_vercel";
import {
  test,
  prepareDeploymentApp,
  holdNextMigrationPreview,
  writeDeploymentUpdate,
  readCommittedDeploymentUpdate,
} from "./helpers/guided_deployment";

test("guides production migration, publishes to Cloudflare, and reviews migration again before redeploying", async ({
  po,
}) => {
  const appDir = await prepareDeploymentApp(po);
  const deploy = po.deployDialog;
  await deploy.open();
  await deploy.expectStep(1, "Database");
  // Establish the enabled baseline before checking production's migration gate.
  await deploy.selectDatabase("development");
  await expect(deploy.button("Continue to GitHub")).toBeEnabled();
  await deploy.selectDatabase("production");
  await expect(deploy.button("Continue to GitHub")).toBeDisabled();

  const finishCancelledPlan = await holdNextMigrationPreview(po);
  await deploy.button("Migrate to Production").click();
  await expect(deploy.planning).toBeVisible();
  await expect(deploy.button("Cancel")).toBeEnabled();
  await expect(deploy.button("Development database")).toBeEnabled();
  await expect(deploy.button("Close")).toBeEnabled();
  await deploy.button("Cancel").click();
  await expect(deploy.planning).toBeHidden();
  await expect(deploy.button("Migrate to Production")).toBeFocused();
  await expect(deploy.button("Development database")).toBeEnabled();
  await finishCancelledPlan();
  await expect(deploy.migrationSql).toBeHidden();
  await expect(deploy.button("Continue to GitHub")).toBeDisabled();

  const failPlan = await holdNextMigrationPreview(po);
  await deploy.button("Migrate to Production").click();
  await expect(deploy.planning).toBeVisible();
  await failPlan("Database connection timed out");
  await expect(deploy.planning).toBeHidden();
  await expect(deploy.migrationError).toBeVisible();
  await expect(deploy.button("Development database")).toBeEnabled();
  await expect(deploy.button("Continue to GitHub")).toBeDisabled();
  await deploy.button("Show details").click();
  await expect(
    deploy.dialog.getByText(/Database connection timed out/),
  ).toBeVisible();
  await deploy.button("Retry").click();
  await expect(
    deploy.dialog.getByText("Destructive changes detected"),
  ).toBeVisible();
  await expect(po.page.getByRole("dialog")).toHaveCount(1);
  await deploy.button("Cancel").click();
  await expect(deploy.button("Migrate to Production")).toBeFocused();
  await expect(deploy.button("Continue to GitHub")).toBeDisabled();
  await deploy.button("Migrate to Production").click();
  await deploy.approveMigration();
  await deploy.expectMigrationApplied();
  await deploy.publishToCloudflare("guided-production");

  await po.githubConnector.clearPushEvents();
  await writeDeploymentUpdate(
    appDir,
    "production-update.txt",
    "approved production update\n",
  );
  await deploy.open();
  await expect(
    deploy.dialog.getByText("This app is already hosted. Deploy will:"),
  ).toBeVisible();
  expect(await po.githubConnector.getPushEvents()).toEqual([]);
  await deploy.button("Review and deploy").click();
  await deploy.expectStep(2, "Database");
  await expect(deploy.migrationSql).toBeVisible();
  expect(await po.githubConnector.getPushEvents()).toEqual([]);
  await deploy.approveMigration();
  await deploy.expectGitHubPushVerified();
  await po.githubConnector.expectPushEvent({
    repo: "guided-production",
    branch: "main",
    operation: "push",
  });
  expect(readCommittedDeploymentUpdate(appDir, "production-update.txt")).toBe(
    "approved production update\n",
  );
  await deploy.finish();
});

test("publishes with the development database and skips migration when redeploying", async ({
  po,
}) => {
  const appDir = await prepareDeploymentApp(po);
  const deploy = po.deployDialog;
  await deploy.open();
  await deploy.selectDatabase("development");
  await expect(
    deploy.dialog.getByText(
      /Your deployed app will share the development database/,
    ),
  ).toBeVisible();
  await expect(deploy.button("Migrate to Production")).toBeHidden();
  await deploy.publishToCloudflare("guided-development");
  await writeDeploymentUpdate(
    appDir,
    "development-update.txt",
    "development update\n",
  );
  await po.githubConnector.clearPushEvents();
  await deploy.open();
  await deploy.button("Review and deploy").click();
  await deploy.expectStep(3, "Deployment");
  await deploy.expectGitHubPushVerified();
  await expect(deploy.migrationSql).toBeHidden();
  await po.githubConnector.expectPushEvent({
    repo: "guided-development",
    branch: "main",
    operation: "push",
  });
  await deploy.finish();
});

test("publishes to Vercel with production database config and verifies the current build after a retry", async ({
  po,
}) => {
  const vercel = new FakeVercel(po.page.request, po.fakeLlmPort);
  await vercel.reset();
  await prepareDeploymentApp(po);
  const deploy = po.deployDialog;
  await deploy.open();
  await deploy.selectDatabase("production");
  await deploy.button("Migrate to Production").click();
  await deploy.approveMigration();
  await deploy.expectMigrationApplied();
  await deploy.continueToDeployment("guided-vercel");
  await deploy.connectToVercel();
  await deploy.enterVercelProjectName("guided-vercel");
  await expect(deploy.vercelSyncPreview).toContainText("production");
  await expect(deploy.vercelSyncPreview).toContainText("DATABASE_URL");
  await expect(deploy.vercelSyncPreview).toContainText("NEON_AUTH_BASE_URL");
  await expect(deploy.button("Finish")).toBeHidden();
  await deploy.createVercelProject("guided-vercel");
  await expect(deploy.vercelBuilding).toBeVisible();

  // Guided project creation defers deployment until the selected branch's
  // configuration is synced. Assert there is only one build and inspect the
  // environment it actually received, not just the success message.
  await expect
    .poll(async () => (await vercel.getState()).deployments.length)
    .toBe(1);
  const state = await vercel.getState();
  expect(state.projects).toHaveLength(1);
  expect(state.projects[0]).toMatchObject({
    name: "guided-vercel",
    framework: "vite",
    gitRepository: { type: "github", repo: "testuser/guided-vercel" },
  });
  const [guidedBuild] = state.deployments;
  expect(guidedBuild.envRevision).toBeGreaterThan(0);
  expect(guidedBuild).toMatchObject({
    projectId: state.projects[0].id,
    target: "production",
    gitSource: {
      type: "github",
      org: "testuser",
      repo: "guided-vercel",
      ref: "main",
    },
    env: [
      {
        key: "DATABASE_URL",
        value: "postgresql://test:test@test-main.neon.tech/test",
        type: "encrypted",
        target: ["production"],
      },
      {
        key: "NEON_AUTH_BASE_URL",
        value: "https://test-main.neonauth.us-east-2.aws.neon.tech/neondb/auth",
        type: "encrypted",
        target: ["production"],
      },
    ],
  });

  await vercel.setBuildState(guidedBuild.id, "ERROR");
  await deploy.button("Refresh Deployments").click();
  await expect(
    deploy.dialog.getByText(/The Vercel deployment did not finish/),
  ).toBeVisible();
  await expect(deploy.button("Finish")).toBeHidden();
  await deploy.button("Retry deployment").click();
  await expect
    .poll(async () => (await vercel.getState()).deployments.length)
    .toBe(2);
  await expect(deploy.vercelBuilding).toBeVisible();
  await expect(deploy.button("Finish")).toBeHidden();
  const retryBuild = (await vercel.getState()).deployments[1];
  expect(retryBuild.id).not.toBe(guidedBuild.id);
  expect(retryBuild.env).toEqual(guidedBuild.env);

  // A stale READY result for the previous attempt must not complete the
  // retry currently being verified.
  await vercel.setBuildState(guidedBuild.id, "READY");
  await deploy.button("Refresh Deployments").click();
  await expect(deploy.dialog.getByText("READY", { exact: true })).toBeVisible();
  await expect(deploy.vercelBuilding).toBeVisible();
  await expect(deploy.button("Finish")).toBeHidden();

  await vercel.setBuildState(retryBuild.id, "READY");
  await deploy.button("Refresh Deployments").click();
  await expect(
    deploy.dialog.getByText(
      "Deployment verified and environment variables configured.",
    ),
  ).toBeVisible();
  await deploy.finish();
});
