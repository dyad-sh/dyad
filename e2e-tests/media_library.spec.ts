import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";
// TODO: Investigate and enable on Windows — currently skipped due to file
// system timing differences. Ensure CI covers this on macOS/Linux.
import { testSkipIfWindows } from "./helpers/test_helper";
import type { PageObject } from "./helpers/test_helper";

const IMAGE_FIXTURE_PATH = path.join(
  __dirname,
  "fixtures",
  "images",
  "logo.png",
);

async function importAppAndSeedMedia({
  po,
  fixtureName,
  files,
}: {
  po: PageObject;
  fixtureName: string;
  files: string[];
}) {
  await po.navigation.goToAppsTab();
  await po.appManagement.importApp(fixtureName);

  // Wait for the title bar to record the imported app name.
  // getCurrentAppName() only checks "not 'no app selected'", which races
  // on subsequent imports where the title bar already shows a previous app.
  await expect(po.appManagement.getTitleBarAppNameButton()).toHaveAttribute(
    "data-app-name",
    fixtureName,
    { timeout: 15000 },
  );

  const appName = await po.appManagement.getCurrentAppName();
  if (!appName) {
    throw new Error("Failed to get app name after import");
  }
  const appPath = await po.appManagement.getCurrentAppPath();
  const mediaDirPath = path.join(appPath, ".dyad", "media");
  fs.mkdirSync(mediaDirPath, { recursive: true });

  for (const fileName of files) {
    fs.copyFileSync(IMAGE_FIXTURE_PATH, path.join(mediaDirPath, fileName));
  }

  return { appName, appPath, mediaDirPath };
}

async function openMediaFolderByAppName(po: PageObject, appName: string) {
  const collapsedFolder = po.page
    .locator('[data-testid^="media-folder-"]')
    .filter({ hasText: appName })
    .first();

  await expect(collapsedFolder).toBeVisible({ timeout: 15000 });
  await collapsedFolder.click();
  await expect(po.page.getByTestId("media-folder-back-button")).toBeVisible();
}

async function openMediaActionsForFile(po: PageObject, fileName: string) {
  const thumbnail = po.page
    .getByTestId("media-thumbnail")
    .filter({ hasText: fileName })
    .first();

  await expect(thumbnail).toBeVisible();
  await thumbnail.getByTestId("media-file-actions-trigger").click();
}

testSkipIfWindows(
  "media library - rename, move, delete, and start a new chat with image reference",
  async ({ po }) => {
    await po.setUp();

    const sourceApp = await importAppAndSeedMedia({
      po,
      fixtureName: "minimal",
      files: ["chat-image.png", "move-image.png"],
    });
    const targetApp = await importAppAndSeedMedia({
      po,
      fixtureName: "astro",
      files: [],
    });

    await po.navigation.goToLibraryTab();
    await po.page.getByRole("link", { name: "Media" }).click();

    await openMediaFolderByAppName(po, sourceApp.appName);

    await openMediaActionsForFile(po, "move-image.png");
    await po.page.getByTestId("media-rename-image").click();
    await po.page.getByTestId("media-rename-input").fill("renamed-image");
    await po.page.getByTestId("media-rename-confirm-button").click();

    const sourceRenamedPath = path.join(
      sourceApp.mediaDirPath,
      "renamed-image.png",
    );
    const sourceOldPath = path.join(sourceApp.mediaDirPath, "move-image.png");

    await expect.poll(() => fs.existsSync(sourceRenamedPath)).toBe(true);
    await expect.poll(() => fs.existsSync(sourceOldPath)).toBe(false);

    await openMediaActionsForFile(po, "renamed-image.png");
    await po.page.getByTestId("media-move-to-submenu").click();
    // The move flow uses a dialog with an AppSearchSelect popover.
    await expect(po.page.getByTestId("media-move-dialog")).toBeVisible();
    await po.page.getByLabel("Select target app").click();
    await po.page.getByRole("button", { name: targetApp.appName }).click();
    await po.page.getByTestId("media-move-confirm-button").click();

    const targetMovedPath = path.join(
      targetApp.mediaDirPath,
      "renamed-image.png",
    );

    await expect.poll(() => fs.existsSync(sourceRenamedPath)).toBe(false);
    await expect.poll(() => fs.existsSync(targetMovedPath)).toBe(true);

    await po.page.getByTestId("media-folder-back-button").click();
    await openMediaFolderByAppName(po, targetApp.appName);

    await openMediaActionsForFile(po, "renamed-image.png");
    await po.page.getByTestId("media-delete-image").click();
    await po.page.getByTestId("media-delete-confirm-button").click();

    await expect.poll(() => fs.existsSync(targetMovedPath)).toBe(false);

    // After deleting the last file from the target folder, the folder
    // disappears from the listing and the view returns to the folder list.
    await openMediaFolderByAppName(po, sourceApp.appName);

    await openMediaActionsForFile(po, "chat-image.png");
    await po.page.getByTestId("media-start-chat-with-image").click();

    await expect(po.chatActions.getChatInput()).toBeVisible();
    await expect(po.chatActions.getChatInput()).toContainText(
      `@chat-image.png`,
    );
    expect(await po.appManagement.getCurrentAppName()).toBe(sourceApp.appName);
  },
);
