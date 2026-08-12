import path from "node:path";
import os from "node:os";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { DyadErrorKind } from "@/errors/dyad_error";
import { activeRecordings } from "@/ipc/services/recording_registry";

vi.mock("electron", () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: {
    getPath: vi.fn(() => path.join(os.tmpdir(), "dyad-version-user-data")),
    getAppPath: vi.fn(() => process.cwd()),
  },
}));

const { registerVersionHandlers, versionPreviewHandlerService } =
  await import("./version_handlers");

describe("version recording admission", () => {
  beforeAll(() => {
    registerVersionHandlers();
  });

  afterEach(() => {
    activeRecordings.clear();
  });

  function startRecordingStandIn(appId: number): void {
    activeRecordings.set(appId, {
      appId,
      stop: () => {},
      done: Promise.resolve({ envRestored: true }),
    });
  }

  it("refuses restore before its preparation phase can queue", async () => {
    startRecordingStandIn(7);

    await expect(
      versionPreviewHandlerService.restoreToMessage({
        appId: 7,
        chatId: 1,
        messageId: 1,
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  });

  it("refuses version checkout while recording", async () => {
    startRecordingStandIn(7);

    await expect(
      versionPreviewHandlerService.checkoutVersion({
        appId: 7,
        purpose: "preview",
        versionId: "abc123",
      }),
    ).rejects.toMatchObject({ kind: DyadErrorKind.Precondition });
  });
});
