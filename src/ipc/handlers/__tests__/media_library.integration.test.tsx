import fs from "node:fs";
import path from "node:path";

import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { apps, chats } from "@/db/schema";
import {
  setupHybridChatHarness,
  type HybridChatHarness,
} from "@/testing/hybrid_chat_harness";
import { h } from "@/testing/hybrid.setup";

const IMAGE_FIXTURE_PATH = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "images",
  "logo.png",
);

type TestApp = {
  appId: number;
  name: string;
  appDir: string;
  mediaDir: string;
};

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

describe("media library actions (integration)", () => {
  let harness: HybridChatHarness;
  let appCounter = 0;
  let appsRoot: string;

  beforeAll(async () => {
    harness = await setupHybridChatHarness({
      electronMock: h,
      settings: { isTestMode: true },
    });
    appsRoot = path.dirname(harness.appDir);
  }, 60_000);

  afterEach(() => {
    cleanup();
  });

  afterAll(async () => {
    await harness?.dispose();
  });

  async function createAppWithMedia(
    baseName: string,
    fileNames: string[],
  ): Promise<TestApp> {
    appCounter += 1;
    const name = `${baseName}-${appCounter}`;
    const appDir = path.join(appsRoot, slug(name));
    const mediaDir = path.join(appDir, ".dyad", "media");
    fs.mkdirSync(mediaDir, { recursive: true });
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({ name, private: true }, null, 2) + "\n",
    );

    for (const fileName of fileNames) {
      fs.copyFileSync(IMAGE_FIXTURE_PATH, path.join(mediaDir, fileName));
    }

    const [appRow] = await harness.db
      .insert(apps)
      .values({ name, path: appDir })
      .returning();
    await harness.db.insert(chats).values({ appId: appRow.id });

    return { appId: appRow.id, name, appDir, mediaDir };
  }

  function mountMediaLibrary() {
    harness.mountSurface({
      route: "/library/media",
      appId: harness.appId,
    });
  }

  async function openMediaFolder(app: TestApp) {
    const folder = await screen.findByTestId(`media-folder-${app.appId}`);
    expect(folder.textContent).toContain(app.name);
    fireEvent.click(folder);
    await screen.findByTestId(`media-folder-open-${app.appId}`);
  }

  async function openActionsForFile(fileName: string) {
    const thumbnail = await screen.findByText(fileName);
    const container = thumbnail.closest('[data-testid="media-thumbnail"]');
    if (!container) {
      throw new Error(`No thumbnail container found for ${fileName}`);
    }
    const trigger = within(container as HTMLElement).getByTestId(
      "media-file-actions-trigger",
    );
    fireEvent.pointerDown(trigger);
    fireEvent.pointerUp(trigger);
    fireEvent.click(trigger);
    await screen.findByTestId("media-rename-image");
  }

  it("renames, moves, and deletes media files through the media library UI", async () => {
    const sourceApp = await createAppWithMedia("media-source", [
      "chat-image.png",
      "move-image.png",
    ]);
    const targetApp = await createAppWithMedia("media-target", []);

    mountMediaLibrary();
    await screen.findByText("Media");
    await openMediaFolder(sourceApp);

    await openActionsForFile("move-image.png");
    fireEvent.click(screen.getByTestId("media-rename-image"));
    await screen.findByTestId("media-rename-dialog");
    fireEvent.change(screen.getByTestId("media-rename-input"), {
      target: { value: "renamed-image" },
    });
    fireEvent.click(screen.getByTestId("media-rename-confirm-button"));

    const sourceRenamedPath = path.join(
      sourceApp.mediaDir,
      "renamed-image.png",
    );
    const sourceOldPath = path.join(sourceApp.mediaDir, "move-image.png");
    await waitFor(() => {
      expect(fs.existsSync(sourceRenamedPath)).toBe(true);
      expect(fs.existsSync(sourceOldPath)).toBe(false);
    });

    await openActionsForFile("renamed-image.png");
    fireEvent.click(screen.getByTestId("media-move-to-submenu"));
    await screen.findByTestId("media-move-dialog");
    await harness.openPopover(screen.getByLabelText("Select target app"));
    fireEvent.click(
      await screen.findByRole("button", { name: targetApp.name }),
    );
    fireEvent.click(screen.getByTestId("media-move-confirm-button"));

    const targetMovedPath = path.join(targetApp.mediaDir, "renamed-image.png");
    await waitFor(() => {
      expect(fs.existsSync(sourceRenamedPath)).toBe(false);
      expect(fs.existsSync(targetMovedPath)).toBe(true);
    });

    fireEvent.click(screen.getByTestId("media-folder-back-button"));
    await openMediaFolder(targetApp);

    await openActionsForFile("renamed-image.png");
    fireEvent.click(screen.getByTestId("media-delete-image"));
    await screen.findByTestId("media-delete-dialog");
    fireEvent.click(screen.getByTestId("media-delete-confirm-button"));

    await waitFor(() => {
      expect(fs.existsSync(targetMovedPath)).toBe(false);
    });

    const sourceRow = await harness.db.query.apps.findFirst({
      where: eq(apps.id, sourceApp.appId),
    });
    const targetRow = await harness.db.query.apps.findFirst({
      where: eq(apps.id, targetApp.appId),
    });
    expect(sourceRow?.name).toBe(sourceApp.name);
    expect(targetRow?.name).toBe(targetApp.name);
  }, 60_000);
});
