import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  setExtensionData,
  getExtensionData,
  getAllExtensionData,
  deleteExtensionData,
} from "../extensions/core/extension_data";

const dbMocks = vi.hoisted(() => {
  const where = vi.fn();
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const insert = vi.fn(() => ({
    values: vi.fn().mockResolvedValue(undefined),
  }));
  const select = vi.fn(() => ({
    from: vi.fn(() => ({ where, limit: vi.fn(() => Promise.resolve([])) })),
  }));
  const delete_ = vi.fn(() => ({ where }));

  return { update, set, where, insert, select, delete: delete_ };
});

const schemaMocks = vi.hoisted(() => {
  return {
    extensionData: {
      appId: "extension_data.app_id",
      extensionId: "extension_data.extension_id",
      key: "extension_data.key",
    },
  };
});

const drizzleMocks = vi.hoisted(() => {
  return {
    eq: vi.fn((column: unknown, value: unknown) => `EQ(${column}, ${value})`),
    and: vi.fn((...args: unknown[]) => `AND(${args.join(", ")})`),
  };
});

vi.mock("@/db", () => ({
  getDb: vi.fn(() => dbMocks),
}));

vi.mock("@/db/schema", () => ({
  extensionData: schemaMocks.extensionData,
}));

vi.mock("drizzle-orm", () => ({
  eq: drizzleMocks.eq,
  and: drizzleMocks.and,
}));

vi.mock("electron-log", () => ({
  default: {
    scope: vi.fn(() => ({
      error: vi.fn(),
      log: vi.fn(),
      warn: vi.fn(),
    })),
  },
}));

describe("Extension Data Helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("setExtensionData", () => {
    it("should insert new data when record does not exist", async () => {
      // Mock select to return empty array (no existing record)
      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      await setExtensionData("test-ext", 1, "projectId", "proj_123");

      expect(dbMocks.insert).toHaveBeenCalled();
      expect(dbMocks.update).not.toHaveBeenCalled();
    });

    it("should update existing data when record exists", async () => {
      // Mock select to return existing record
      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([{ id: 1, value: '{"old":"data"}' }]),
            ),
          })),
        })),
      });

      // Mock update chain
      const updateWhere = vi.fn().mockResolvedValue(undefined);
      dbMocks.where.mockReturnValue(updateWhere);
      dbMocks.set.mockReturnValue({ where: updateWhere });

      await setExtensionData("test-ext", 1, "projectId", "proj_123");

      expect(dbMocks.update).toHaveBeenCalled();
      expect(dbMocks.set).toHaveBeenCalledWith(
        expect.objectContaining({
          value: JSON.stringify("proj_123"),
        }),
      );
    });
  });

  describe("getExtensionData", () => {
    it("should return parsed JSON value when data exists", async () => {
      const mockValue = { projectId: "proj_123", name: "My Project" };
      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() =>
              Promise.resolve([{ id: 1, value: JSON.stringify(mockValue) }]),
            ),
          })),
        })),
      });

      const result = await getExtensionData("test-ext", 1, "projectId");

      expect(result).toEqual(mockValue);
    });

    it("should return null when data does not exist", async () => {
      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([])),
          })),
        })),
      });

      const result = await getExtensionData("test-ext", 1, "projectId");

      expect(result).toBeNull();
    });

    it("should return null when value is null", async () => {
      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => ({
            limit: vi.fn(() => Promise.resolve([{ id: 1, value: null }])),
          })),
        })),
      });

      const result = await getExtensionData("test-ext", 1, "projectId");

      expect(result).toBeNull();
    });
  });

  describe("getAllExtensionData", () => {
    it("should return all extension data as a record", async () => {
      const mockData = [
        { key: "projectId", value: JSON.stringify("proj_123") },
        { key: "deploymentUrl", value: JSON.stringify("https://example.com") },
        { key: "invalid", value: "invalid json" }, // Should be skipped
      ];

      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve(mockData)),
        })),
      });

      const result = await getAllExtensionData("test-ext", 1);

      expect(result).toEqual({
        projectId: "proj_123",
        deploymentUrl: "https://example.com",
      });
    });

    it("should return empty object when no data exists", async () => {
      dbMocks.select.mockReturnValue({
        from: vi.fn(() => ({
          where: vi.fn(() => Promise.resolve([])),
        })),
      });

      const result = await getAllExtensionData("test-ext", 1);

      expect(result).toEqual({});
    });
  });

  describe("deleteExtensionData", () => {
    it("should delete specific key when key is provided", async () => {
      const deleteWhere = vi.fn().mockResolvedValue(undefined);
      dbMocks.where.mockReturnValue(deleteWhere);
      dbMocks.delete.mockReturnValue({ where: deleteWhere });

      await deleteExtensionData("test-ext", 1, "projectId");

      expect(dbMocks.delete).toHaveBeenCalled();
      expect(drizzleMocks.and).toHaveBeenCalled();
    });

    it("should delete all extension data when key is not provided", async () => {
      const deleteWhere = vi.fn().mockResolvedValue(undefined);
      dbMocks.where.mockReturnValue(deleteWhere);
      dbMocks.delete.mockReturnValue({ where: deleteWhere });

      await deleteExtensionData("test-ext", 1);

      expect(dbMocks.delete).toHaveBeenCalled();
      expect(drizzleMocks.and).toHaveBeenCalled();
    });
  });
});
