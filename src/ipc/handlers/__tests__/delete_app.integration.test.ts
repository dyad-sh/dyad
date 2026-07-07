// @vitest-environment node
//
// Migrated from e2e-tests/delete_app.spec.ts.
//
// The e2e test created an app via a chat prompt, deleted it through the app
// details UI, and verified the app folder was removed from disk and the app
// disappeared from the app list. Here we run the real chat flow (which writes
// files + commits into the app dir), then invoke the real `delete-app` IPC
// handler and assert the db rows and the on-disk folder are gone.
// UI-only assertions (title bar shows "none", list item hidden) are dropped.
import fs from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => {
  process.env.NODE_ENV = "development";
  return { ipcHandlers: new Map() };
});

vi.mock("electron", async () => {
  const { createElectronMock } = await import("@/testing/electron_mock");
  return createElectronMock(h);
});

import {
  setupChatFlowHarness,
  type ChatFlowHarness,
} from "@/testing/chat_flow_harness";
import {
  createFakeIpcEvent,
  type RendererEvent,
} from "@/testing/electron_mock";
import { registerAppHandlers } from "@/ipc/handlers/app_handlers";
import { apps, chats } from "@/db/schema";
import { eq } from "drizzle-orm";

type Envelope = { ok: boolean; value?: unknown; error?: unknown };

describe("delete app (integration)", () => {
  let harness: ChatFlowHarness;
  const rendererEvents: RendererEvent[] = [];

  const invoke = async (
    channel: string,
    input?: unknown,
  ): Promise<Envelope> => {
    const handler = h.ipcHandlers.get(channel);
    if (!handler) throw new Error(`No ipc handler registered for ${channel}`);
    return (await handler(
      createFakeIpcEvent(rendererEvents),
      input,
    )) as Envelope;
  };

  beforeAll(async () => {
    harness = await setupChatFlowHarness({ electronMock: h });
    registerAppHandlers();
  }, 30_000);

  afterAll(async () => {
    await harness?.dispose();
  });

  it("deletes the app folder, db row, and chats", async () => {
    // Create some real content in the app via the chat flow (same as the e2e
    // sending "hi": the canned response writes file1.txt and commits).
    const { result } = await harness.streamChat("hi");
    expect(result).toBe(harness.chatId);
    expect(harness.appFileExists("file1.txt")).toBe(true);
    expect(fs.existsSync(harness.appDir)).toBe(true);

    const deleteResult = await invoke("delete-app", { appId: harness.appId });
    expect(deleteResult.ok).toBe(true);

    // App folder is removed from disk.
    expect(fs.existsSync(harness.appDir)).toBe(false);

    // App row is gone from the db.
    const appRows = await harness.db.query.apps.findMany({
      where: eq(apps.id, harness.appId),
    });
    expect(appRows).toEqual([]);

    // Chats cascade-deleted.
    const chatRows = await harness.db.query.chats.findMany({
      where: eq(chats.appId, harness.appId),
    });
    expect(chatRows).toEqual([]);

    // The app no longer shows up in the app list (backend equivalent of the
    // e2e "app list item not visible" assertion).
    const listResult = await invoke("list-apps");
    expect(listResult.ok).toBe(true);
    const listed = (listResult.value as { apps: Array<{ id: number }> }).apps;
    expect(listed.some((a) => a.id === harness.appId)).toBe(false);
  }, 30_000);

  it("returns an error for a nonexistent app", async () => {
    const deleteResult = await invoke("delete-app", { appId: 999_999 });
    expect(deleteResult.ok).toBe(false);
  });
});
