import { expect } from "@playwright/test";
import { test } from "./helpers/test_helper";

test.describe("Vercel Account Status", () => {
  test.beforeEach(async ({ po }) => {
    // Clear any existing soft block state
    await po.vercelConnector.clearSoftBlock();
  });

  test("should show warning when account has fair use limits exceeded", async ({
    po,
  }) => {
    await po.setUp();
    await po.sendPrompt("tc=basic");

    // Set up GitHub first (required for Vercel)
    await po.getTitleBarAppNameButton().click();
    await po.githubConnector.connect();
    await po.githubConnector.fillCreateRepoName("test-vercel-warning");
    await po.githubConnector.clickCreateRepoButton();

    // Set the soft block before navigating to Vercel section
    await po.vercelConnector.setSoftBlock(
      "FAIR_USE_LIMITS_EXCEEDED",
      "functionInvocation",
    );

    // Navigate to Publish tab by clicking on title bar app name
    await po.getTitleBarAppNameButton().click();

    // Create Vercel project
    await po.page
      .getByTestId("vercel-create-project-name-input")
      .fill("test-vercel-project");
    await po.page.getByRole("button", { name: "Create Project" }).click();

    // Wait for project to be created and warning to appear
    await expect(po.vercelConnector.getAccountWarning()).toBeVisible({
      timeout: 10000,
    });

    // Verify the warning contains the expected message
    await expect(po.vercelConnector.getAccountWarning()).toContainText(
      "fair use limits",
    );
    await expect(po.vercelConnector.getAccountWarning()).toContainText(
      "serverless function invocations",
    );
  });

  test("should not show warning when account is not blocked", async ({
    po,
  }) => {
    await po.setUp();
    await po.sendPrompt("tc=basic");

    // Set up GitHub first (required for Vercel)
    await po.getTitleBarAppNameButton().click();
    await po.githubConnector.connect();
    await po.githubConnector.fillCreateRepoName("test-vercel-no-warning");
    await po.githubConnector.clickCreateRepoButton();

    // Ensure no soft block is set
    await po.vercelConnector.clearSoftBlock();

    // Navigate to Publish tab
    await po.getTitleBarAppNameButton().click();

    // Create Vercel project
    await po.page
      .getByTestId("vercel-create-project-name-input")
      .fill("test-vercel-ok");
    await po.page.getByRole("button", { name: "Create Project" }).click();

    // Wait for connection
    await expect(po.page.getByTestId("vercel-connected-project")).toBeVisible({
      timeout: 10000,
    });

    // Warning should not be visible
    await expect(po.vercelConnector.getAccountWarning()).not.toBeVisible();
  });

  test("should show warning for subscription canceled", async ({ po }) => {
    await po.setUp();
    await po.sendPrompt("tc=basic");

    // Set up GitHub first (required for Vercel)
    await po.getTitleBarAppNameButton().click();
    await po.githubConnector.connect();
    await po.githubConnector.fillCreateRepoName("test-vercel-sub-canceled");
    await po.githubConnector.clickCreateRepoButton();

    // Set subscription canceled block
    await po.vercelConnector.setSoftBlock("SUBSCRIPTION_CANCELED");

    // Navigate to Publish tab
    await po.getTitleBarAppNameButton().click();

    // Create Vercel project
    await po.page
      .getByTestId("vercel-create-project-name-input")
      .fill("test-vercel-canceled");
    await po.page.getByRole("button", { name: "Create Project" }).click();

    // Wait for warning to appear
    await expect(po.vercelConnector.getAccountWarning()).toBeVisible({
      timeout: 10000,
    });

    // Verify the warning contains the expected message
    await expect(po.vercelConnector.getAccountWarning()).toContainText(
      "subscription has been canceled",
    );
  });
});
