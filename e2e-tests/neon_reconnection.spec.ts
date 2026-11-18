import { expect } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import type { App, ListAppsResponse } from "@/ipc/types/app";
import { testWithConfig, Timeout } from "./helpers/test_helper";

const rejectedCredentials = {
  accessToken: { value: "rejected-neon-access-token" },
  refreshToken: { value: "rejected-neon-refresh-token" },
  expiresIn: 3600,
  tokenTimestamp: 1,
  reconnectRequired: true,
};

testWithConfig({
  preLaunchHook: async ({ userDataDir }) => {
    await fs.mkdir(userDataDir, { recursive: true });
    await fs.writeFile(
      path.join(userDataDir, "user-settings.json"),
      JSON.stringify({ neon: rejectedCredentials }),
    );
  },
})(
  "reconnects Neon without losing the linked project after dismissing the chat notice",
  async ({ po }) => {
    const entryUrl = po.page.url();
    await po.setUp();
    await po.importApp("recorder");
    const notice = po.page.getByTestId("neon-reconnection-notice");
    // Rejected account credentials alone must not warn in an unlinked chat.
    await expect(po.page.getByTestId("chat-input-container")).toBeVisible();
    await expect(notice).toBeHidden();

    const appName = await po.appManagement.getCurrentAppName();
    const appDir = await po.appManagement.getCurrentAppPath();
    // Seed an already-linked app. The packaged test build fakes Neon API calls;
    // refresh rejection is covered by neon_management_client.test.ts.
    const linkedApp = await po.page.evaluate(async (name) => {
      await (window as any).electron.ipcRenderer.invoke(
        "test:set-neon-auth-fixture",
        { appName: name },
      );
      const { apps } = (await (window as any).electron.ipcRenderer.invoke(
        "list-apps",
      )) as ListAppsResponse;
      const app = apps.find((candidate) => candidate.name === name);
      if (!app) throw new Error(`Linked app ${name} was not found`);
      return (await (window as any).electron.ipcRenderer.invoke(
        "get-app",
        app.id,
      )) as App;
    }, appName);
    const expectedLink = {
      neonProjectId: "test-project-id",
      neonDevelopmentBranchId: "test-development-branch-id",
      neonActiveBranchId: "test-development-branch-id",
    };
    expect(linkedApp).toMatchObject(expectedLink);
    const envPath = path.join(appDir, ".env.local");
    const envBefore = [
      "DATABASE_URL=postgresql://test:test@test-development.neon.tech/test",
      "NEON_AUTH_BASE_URL=https://test-development.neonauth.us-east-2.aws.neon.tech/neondb/auth",
      "NEON_AUTH_COOKIE_SECRET=test-cookie-secret",
      "UNRELATED_SETTING=keep-me",
      "",
    ].join("\n");
    await fs.writeFile(envPath, envBefore);

    // Clear the renderer cache after the direct fixture write by reopening the
    // packaged entry point; reloading a file:// chat route is unsupported.
    await po.page.goto(entryUrl);
    await po.page.waitForLoadState("domcontentloaded");
    await po.navigation.goToChatTab();
    await expect(notice).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(
      notice.getByText("Your existing project connection will be kept.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      notice.getByRole("button", { name: "Reconnect Neon", exact: true }),
    ).toBeEnabled();
    await notice.getByRole("button", { name: "Close", exact: true }).click();
    await expect(notice).toBeHidden();

    // Dismissal only hides the chat banner, leaving recovery available in the
    // publish panel and the app's connector.
    await po.previewPanel.selectPreviewMode("publish");
    const publishPanel = po.page.locator("#preview-panel");
    await expect(
      publishPanel.getByTestId("neon-reconnection-notice"),
    ).toBeVisible();
    await expect(publishPanel.getByTestId("database-section")).toBeHidden();

    await po.appManagement.getTitleBarAppNameButton().click();
    await expect(notice).toBeVisible();
    await expect(
      po.page.getByRole("button", { name: "Disconnect project", exact: true }),
    ).toBeVisible();
    const branchSelect = po.page.getByTestId("neon-branch-select");
    await expect(branchSelect).toBeHidden();

    await notice
      .getByRole("button", { name: "Reconnect Neon", exact: true })
      .click();
    await expect(branchSelect).toBeVisible({ timeout: Timeout.MEDIUM });
    await expect(branchSelect).toContainText("development");
    await expect(
      po.page.getByText("Test Project", { exact: true }),
    ).toBeVisible();
    await expect(notice).toBeHidden();
    await expect(po.page.getByTestId("neon-project-select")).toBeHidden();

    // The real OAuth-return handler replaces the rejected credentials and
    // clears the recovery flag, without rewriting the database configuration.
    await expect
      .poll(() => po.settings.recordSettings().neon)
      .toMatchObject({
        accessToken: { value: "fake-neon-access-token" },
        refreshToken: { value: "fake-neon-refresh-token" },
      });
    expect(po.settings.recordSettings().neon).not.toHaveProperty(
      "reconnectRequired",
      true,
    );
    expect(await fs.readFile(envPath, "utf8")).toBe(envBefore);
    const reconnectedApp = await po.page.evaluate(async (appId) => {
      return (await (window as any).electron.ipcRenderer.invoke(
        "get-app",
        appId,
      )) as App;
    }, linkedApp.id);
    expect(reconnectedApp).toMatchObject(expectedLink);

    await po.navigation.clickBackButton();
    // The publish panel was open before visiting app details. Recovery must
    // restore its database controls as well as the connector's branch picker.
    await expect(publishPanel.getByTestId("database-section")).toBeVisible({
      timeout: Timeout.MEDIUM,
    });
    await expect(notice).toBeHidden();
  },
);
