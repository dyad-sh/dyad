import fs from "node:fs";
import path from "node:path";

import { expect } from "@playwright/test";

import { test, Timeout, type PageObject } from "./helpers/test_helper";

async function expectImportedApp(po: PageObject, appName: string) {
  await expect
    .poll(
      async () => {
        await po.appManagement.showAppList();
        return po.appManagement
          .getAppListItem({ appName })
          .isVisible()
          .catch(() => false);
      },
      { timeout: Timeout.LONG },
    )
    .toBe(true);
  await po.appManagement.clickAppListItem({ appName });
  await expect(po.appManagement.getTitleBarAppNameButton()).toHaveAttribute(
    "data-app-name",
    appName,
  );
}

test("imports apps from the authenticated list and a GitHub URL", async ({
  po,
}) => {
  await po.setUp();
  await po.page.getByRole("button", { name: "Import App" }).click();
  await po.page.getByRole("tab", { name: "Your GitHub Repos" }).click();
  await po.githubConnector.connect();

  const repoRow = po.page.getByTestId(
    "github-repo-row-testuser-existing-vite-app",
  );
  await expect(repoRow).toBeVisible({ timeout: Timeout.MEDIUM });
  await repoRow.getByRole("button", { name: "Import" }).click();
  await expect(po.page.getByRole("dialog", { name: "Import App" })).toBeHidden({
    timeout: Timeout.LONG,
  });
  await expectImportedApp(po, "existing-vite-app");

  const importedPath = await po.appManagement.getCurrentAppPath();
  await expect
    .poll(
      () => {
        const packageJson = path.join(importedPath, "package.json");
        return (
          fs.existsSync(packageJson) &&
          fs
            .readFileSync(packageJson, "utf8")
            .includes("@dyad-sh/react-vite-component-tagger")
        );
      },
      { timeout: Timeout.LONG },
    )
    .toBe(true);

  await po.navigation.goToAppsTab();
  await po.page.getByRole("button", { name: "Import App" }).click();
  await po.page.getByRole("tab", { name: "GitHub URL" }).click();
  const urlPanel = po.page.getByLabel("GitHub URL");
  const urlInput = urlPanel.getByPlaceholder(
    "https://github.com/user/repo.git",
  );
  const appNameInput = urlPanel.getByPlaceholder(/Leave empty/);
  await urlInput.fill("https://github.com/testuser/existing-vite-app.git");
  await urlInput.blur();
  await expect(appNameInput).toHaveValue("existing-vite-app");
  await appNameInput.fill("github-url-e2e");
  await urlPanel.getByRole("button", { name: "Import", exact: true }).click();
  await expect(po.page.getByRole("dialog", { name: "Import App" })).toBeHidden({
    timeout: Timeout.LONG,
  });
  await expectImportedApp(po, "github-url-e2e");
});
