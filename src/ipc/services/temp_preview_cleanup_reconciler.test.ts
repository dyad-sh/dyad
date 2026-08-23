import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  clearMarker: vi.fn(),
  deletePreview: vi.fn(),
  findApp: vi.fn(),
  listPending: vi.fn(),
  logError: vi.fn(),
  logInfo: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      error: mocks.logError,
      info: mocks.logInfo,
      warn: mocks.logWarn,
    }),
  },
}));

vi.mock("drizzle-orm", () => ({ eq: vi.fn(() => "where") }));
vi.mock("@/db", () => ({
  db: { query: { apps: { findFirst: mocks.findApp } } },
}));
vi.mock("@/db/schema", () => ({ apps: { id: "id" } }));
vi.mock("./temp_preview_service", () => ({
  clearTempPreviewAppDeletionMarker: mocks.clearMarker,
  deleteTempPreviewForApp: mocks.deletePreview,
  listPendingTempPreviewDeletionAppIds: mocks.listPending,
}));

import { reconcilePendingTempPreviewDeletions } from "./temp_preview_cleanup_reconciler";

describe("reconcilePendingTempPreviewDeletions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.clearMarker.mockResolvedValue(undefined);
    mocks.deletePreview.mockResolvedValue(undefined);
    mocks.listPending.mockResolvedValue([]);
  });

  it("clears aborted markers for live apps and revokes previews for deleted apps", async () => {
    mocks.listPending.mockResolvedValue([7, 8]);
    mocks.findApp.mockResolvedValueOnce({ id: 7 }).mockResolvedValueOnce(null);

    await reconcilePendingTempPreviewDeletions();

    expect(mocks.clearMarker).toHaveBeenCalledWith(7);
    expect(mocks.deletePreview).toHaveBeenCalledWith(8);
    expect(mocks.deletePreview).not.toHaveBeenCalledWith(7);
  });

  it("retains a failed cleanup marker and continues reconciling", async () => {
    mocks.listPending.mockResolvedValue([7, 8]);
    mocks.findApp.mockResolvedValue(null);
    mocks.deletePreview
      .mockRejectedValueOnce(new Error("temp.md unavailable"))
      .mockResolvedValueOnce(undefined);

    await expect(
      reconcilePendingTempPreviewDeletions(),
    ).resolves.toBeUndefined();

    expect(mocks.deletePreview).toHaveBeenCalledTimes(2);
    expect(mocks.clearMarker).not.toHaveBeenCalled();
    expect(mocks.logWarn).toHaveBeenCalledWith(
      expect.stringContaining("durable marker and capability remain for retry"),
      expect.any(Error),
    );
  });

  it("runs from main only after database initialization", () => {
    const mainSource = readFileSync(
      resolve(process.cwd(), "src/main.ts"),
      "utf8",
    );

    expect(mainSource.indexOf("initializeDatabase();")).toBeGreaterThan(-1);
    expect(
      mainSource.indexOf("reconcilePendingTempPreviewDeletions()"),
    ).toBeGreaterThan(mainSource.indexOf("initializeDatabase();"));
  });
});
