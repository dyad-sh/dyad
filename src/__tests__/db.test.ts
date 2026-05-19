import { beforeEach, describe, expect, it, vi } from "vitest";

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
      statSync: vi.fn(),
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

describe("initializeDatabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.fs.existsSync.mockImplementation((filePath) =>
      String(filePath).includes("drizzle"),
    );
  });

  it("closes the sqlite handle and clears the singleton when migrations fail", async () => {
    const migrationError = new Error("migration failed");
    mocks.migrate.mockImplementation(() => {
      throw migrationError;
    });
    const { initializeDatabase, getDb } = await loadDbModule();

    expect(() => initializeDatabase()).toThrow(migrationError);

    expect(mocks.sqlite.close).toHaveBeenCalled();
    expect(() => getDb()).toThrow("Database not initialized");
  });
});
