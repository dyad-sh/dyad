// @vitest-environment node
//
// Migrated from e2e-tests/media_library.spec.ts.
//
// The e2e test drove the Library > Media UI to rename, move (across apps),
// and delete media files under each app's `.dyad/media` directory, asserting
// the file-system effects. Here we exercise the same real media handlers
// (list-all-media, rename-media-file, move-media-file, delete-media-file)
// directly against two apps and assert the fs + listing behavior.
//
// UI-only parts of the e2e (folder expand/collapse navigation and the
// "start new chat with image reference" flow, which just prefills the chat
// input with `@chat-image.png`) are intentionally dropped.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import fs from "node:fs";
import path from "node:path";

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import { registerMediaHandlers } from "@/ipc/handlers/media_handlers";
import { getRegisteredHandlerForTesting } from "@/ipc/handlers/base";
import { apps } from "@/db/schema";

const IMAGE_FIXTURE_PATH = path.join(
  process.cwd(),
  "e2e-tests",
  "fixtures",
  "images",
  "logo.png",
);

interface MediaListing {
  apps: Array<{
    appId: number;
    appName: string;
    appPath: string;
    files: Array<{ fileName: string; appId: number; mimeType: string }>;
  }>;
}

describe("media library (integration)", () => {
  let harness: ChatFlowHarness;
  let sourceMediaDir: string;
  let targetAppId: number;
  let targetAppDir: string;
  let targetMediaDir: string;

  const invoke = async (channel: string, input?: unknown) => {
    const handler = getRegisteredHandlerForTesting(channel);
    return handler({} as any, input);
  };

  const listAllMedia = async (): Promise<MediaListing> =>
    (await invoke("list-all-media")) as MediaListing;

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerMediaHandlers();

    // Seed the source app (the harness's checked-out fixture app) with two
    // media files, mirroring the e2e's importAppAndSeedMedia helper.
    sourceMediaDir = path.join(harness.appDir, ".dyad", "media");
    fs.mkdirSync(sourceMediaDir, { recursive: true });
    for (const fileName of ["chat-image.png", "move-image.png"]) {
      fs.copyFileSync(IMAGE_FIXTURE_PATH, path.join(sourceMediaDir, fileName));
    }

    // Second app ("astro" in the e2e) as the move target — an app row pointing
    // at its own directory, with no media.
    targetAppDir = path.join(harness.userDataDir, "target-app");
    fs.mkdirSync(targetAppDir, { recursive: true });
    fs.writeFileSync(
      path.join(targetAppDir, "package.json"),
      JSON.stringify({ name: "target-app" }),
    );
    const [targetRow] = await harness.db
      .insert(apps)
      .values({ name: "target-app", path: targetAppDir })
      .returning();
    targetAppId = targetRow.id;
    targetMediaDir = path.join(targetAppDir, ".dyad", "media");
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("lists only apps that have media files", async () => {
    const listing = await listAllMedia();

    const sourceEntry = listing.apps.find((a) => a.appId === harness.appId);
    expect(sourceEntry).toBeDefined();
    expect(sourceEntry!.files.map((f) => f.fileName).sort()).toEqual([
      "chat-image.png",
      "move-image.png",
    ]);
    expect(sourceEntry!.files.every((f) => f.mimeType === "image/png")).toBe(
      true,
    );

    // The target app has no media yet, so it is not listed.
    expect(listing.apps.find((a) => a.appId === targetAppId)).toBeUndefined();
  });

  it("renames a media file", async () => {
    await invoke("rename-media-file", {
      appId: harness.appId,
      fileName: "move-image.png",
      newBaseName: "renamed-image",
    });

    expect(fs.existsSync(path.join(sourceMediaDir, "renamed-image.png"))).toBe(
      true,
    );
    expect(fs.existsSync(path.join(sourceMediaDir, "move-image.png"))).toBe(
      false,
    );
  });

  it("moves a media file to another app", async () => {
    await invoke("move-media-file", {
      sourceAppId: harness.appId,
      targetAppId,
      fileName: "renamed-image.png",
    });

    expect(fs.existsSync(path.join(sourceMediaDir, "renamed-image.png"))).toBe(
      false,
    );
    expect(fs.existsSync(path.join(targetMediaDir, "renamed-image.png"))).toBe(
      true,
    );

    // The target app now shows up in the media listing.
    const listing = await listAllMedia();
    const targetEntry = listing.apps.find((a) => a.appId === targetAppId);
    expect(targetEntry).toBeDefined();
    expect(targetEntry!.files.map((f) => f.fileName)).toEqual([
      "renamed-image.png",
    ]);
  });

  it("deletes a media file", async () => {
    await invoke("delete-media-file", {
      appId: targetAppId,
      fileName: "renamed-image.png",
    });

    expect(fs.existsSync(path.join(targetMediaDir, "renamed-image.png"))).toBe(
      false,
    );

    // After deleting its last file, the target app drops out of the listing;
    // the source app still has the untouched chat-image.png.
    const listing = await listAllMedia();
    expect(listing.apps.find((a) => a.appId === targetAppId)).toBeUndefined();
    const sourceEntry = listing.apps.find((a) => a.appId === harness.appId);
    expect(sourceEntry!.files.map((f) => f.fileName)).toEqual([
      "chat-image.png",
    ]);
  });
});
