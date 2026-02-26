import fs from "fs";
import path from "path";
import { expect } from "@playwright/test";
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
    .locator(
      '[data-testid^="media-folder-"][data-library-grid-height-item="true"]',
    )
    .filter({ hasText: appName })
    .first();

  await expect(collapsedFolder).toBeVisible();
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
    await po.page.getByRole("menuitem", { name: targetApp.appName }).click();

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
    await expect(
      po.page.getByTestId("media-thumbnail").filter({
        hasText: "renamed-image.png",
      }),
    ).toHaveCount(0);

    await po.page.getByTestId("media-folder-back-button").click();
    await openMediaFolderByAppName(po, sourceApp.appName);

    await openMediaActionsForFile(po, "chat-image.png");
    await po.page.getByTestId("media-start-chat-with-image").click();

    await expect(po.chatActions.getChatInput()).toBeVisible();
    await expect(po.chatActions.getChatInput()).toContainText(
      `@media:${sourceApp.appName}/chat-image.png`,
    );
    expect(await po.appManagement.getCurrentAppName()).toBe(sourceApp.appName);
  },
);

testSkipIfWindows(
  "media library - collapsed media folders use the tallest visible library card height",
  async ({ po }) => {
    await po.setUp();

    await importAppAndSeedMedia({
      po,
      fixtureName: "minimal",
      files: ["one.png"],
    });
    await importAppAndSeedMedia({
      po,
      fixtureName: "astro",
      files: ["two.png"],
    });
    await importAppAndSeedMedia({
      po,
      fixtureName: "select-component",
      files: ["three.png"],
    });

    await po.navigation.goToLibraryTab();

    await po.page.getByRole("button", { name: "New" }).click();
    await po.page.getByRole("menuitem", { name: "New Prompt" }).click();
    await po.page.getByRole("textbox", { name: "Title" }).fill("Tall prompt");
    await po.page
      .getByRole("textbox", { name: "Content" })
      .fill(
        Array.from(
          { length: 120 },
          (_, index) => `Very long prompt line ${index}`,
        ).join("\n"),
      );
    await po.page.getByRole("button", { name: "Save" }).click();

    const mediaFolders = po.page.locator(
      '[data-testid^="media-folder-"][data-library-grid-height-item="true"]',
    );
    await expect(mediaFolders).toHaveCount(3);

    await expect
      .poll(async () => {
        const mediaHeights = await mediaFolders.evaluateAll((elements) =>
          elements.map((element) =>
            Math.round(element.getBoundingClientRect().height),
          ),
        );
        return new Set(mediaHeights).size;
      })
      .toBe(1);

    const mediaHeight = await mediaFolders
      .first()
      .evaluate((element) =>
        Math.round(element.getBoundingClientRect().height),
      );
    const promptHeight = await po.page
      .getByTestId("library-prompt-card")
      .first()
      .evaluate((element) =>
        Math.round(element.getBoundingClientRect().height),
      );

    expect(mediaHeight).toBeGreaterThanOrEqual(promptHeight - 1);
  },
);
