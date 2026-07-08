import { beforeEach, describe, expect, it, vi } from "vitest";
import path from "node:path";

const mocks = vi.hoisted(() => {
  const sqlite = {
    pragma: vi.fn(),
    close: vi.fn(),
  };
  return {
    sqlite,
    Database: vi.fn(() => sqlite),
    drizzle: vi.fn(() => ({ $client: sqlite })),
    migrate: vi.fn(),
    fs: {
      existsSync: vi.fn(),
      statSync: vi.fn(() => ({ size: 1000 })),
      unlinkSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    getUserDataPath: vi.fn(() => "/mock/user-data"),
  };
});

vi.mock("better-sqlite3", () => ({
  default: mocks.Database,
}));

vi.mock("drizzle-orm/better-sqlite3", () => ({
  drizzle: mocks.drizzle,
}));

vi.mock("drizzle-orm/better-sqlite3/migrator", () => ({
  migrate: mocks.migrate,
}));

vi.mock("node:fs", () => ({
  default: mocks.fs,
}));

vi.mock("@/paths/paths", () => ({
  getUserDataPath: mocks.getUserDataPath,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: () => ({
      log: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

async function loadDbModule() {
  vi.resetModules();
  return import("@/db");
}

describe("database reset helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fs.existsSync.mockReturnValue(true);
  });

  it("closes the database and clears the singleton so it can be reinitialized", async () => {
    const { closeDatabase, getDb, initializeDatabase } = await loadDbModule();

    initializeDatabase();
    closeDatabase();

    expect(mocks.sqlite.close).toHaveBeenCalledOnce();
    expect(() => getDb()).toThrow("Database not initialized");

    initializeDatabase();
    expect(mocks.Database).toHaveBeenCalledTimes(2);
  });

  it("returns the sqlite database and sidecar file paths", async () => {
    const { getDatabaseFilePaths } = await loadDbModule();

    expect(getDatabaseFilePaths()).toEqual([
      path.join("/mock/user-data", "sqlite.db"),
      path.join("/mock/user-data", "sqlite.db-wal"),
      path.join("/mock/user-data", "sqlite.db-shm"),
    ]);
  });
});
