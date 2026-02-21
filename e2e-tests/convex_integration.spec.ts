import { expect } from "@playwright/test";
import { testSkipIfWindows } from "./helpers/test_helper";

// Test Convex integration with a local deployment
testSkipIfWindows(
  "convex integration - connect to local deployment",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Send prompt that triggers add-convex integration
    await po.sendPrompt("tc=add-convex");

    // Verify the integration card is shown
    await expect(po.page.getByText("Set up convex")).toBeVisible();

    // Click "Set up convex" to navigate to app details
    await po.page.getByText("Set up convex").click();

    // On app details page, connect to Convex
    // Use a test deployment URL (this is a mock URL for testing)
    const testDeploymentUrl = "https://test-deployment-123.convex.cloud";
    await po.appManagement.connectConvexDeployment(testDeploymentUrl);

    // Wait for success toast
    await po.toastNotifications.waitForToastWithText(
      "Connected to Convex deployment",
    );

    // Verify the deployment URL is shown as connected
    await expect(po.page.getByText(testDeploymentUrl)).toBeVisible();

    // Navigate back to chat
    await po.navigation.clickBackButton();

    // Verify the integration is now shown as complete in the chat message
    await expect(
      po.page.getByText("Convex integration complete"),
    ).toBeVisible();

    // Snapshot the messages to verify the UI state
    await po.snapshotMessages();
  },
);

testSkipIfWindows(
  "convex integration - disconnect from deployment",
  async ({ po }) => {
    await po.setUp({ autoApprove: true });
    await po.importApp("minimal");

    // Send prompt that triggers add-convex integration
    await po.sendPrompt("tc=add-convex");

    // Navigate to app details and connect
    await po.page.getByText("Set up convex").click();

    const testDeploymentUrl = "https://test-deployment-456.convex.cloud";
    await po.appManagement.connectConvexDeployment(testDeploymentUrl);

    // Wait for connection toast
    await po.toastNotifications.waitForToastWithText(
      "Connected to Convex deployment",
    );

    // Now disconnect
    await po.page.getByRole("button", { name: "Disconnect Convex" }).click();

    // Wait for disconnection toast
    await po.toastNotifications.waitForToastWithText(
      "Disconnected from Convex",
    );

    // Verify the connect form is shown again
    await expect(
      po.page.getByTestId("convex-deployment-url-input"),
    ).toBeVisible();
    await expect(po.page.getByTestId("connect-convex-button")).toBeVisible();
  },
);

testSkipIfWindows(
  "convex integration - stale UI across apps",
  async ({ po }) => {
    await po.setUp();

    // Create first app and integrate with Convex
    await po.sendPrompt("tc=add-convex");
    await po.snapshotMessages();

    await po.page.getByText("Set up convex").click();
    // On app details page:
    const testDeploymentUrl = "https://app1-deployment.convex.cloud";
    await po.appManagement.connectConvexDeployment(testDeploymentUrl);

    // Wait for connection toast
    await po.toastNotifications.waitForToastWithText(
      "Connected to Convex deployment",
    );

    // Navigate back to chat
    await po.navigation.clickBackButton();

    // On chat page - verify integration complete
    await po.snapshotMessages();

    // Create a second app; do NOT integrate it with Convex, and make sure UI is correct
    await po.navigation.goToAppsTab();
    await po.sendPrompt("tc=add-convex");
    await po.snapshotMessages();
  },
);
