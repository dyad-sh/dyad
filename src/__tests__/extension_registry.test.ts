import { describe, it, expect, beforeEach } from "vitest";
import { extensionRegistry } from "../extensions/core/extension_registry";
import type { LoadedExtension } from "../extensions/core/extension_types";

describe("ExtensionRegistry", () => {
  beforeEach(() => {
    // Clear registry before each test
    extensionRegistry.clear();
  });

  function createMockExtension(id: string): LoadedExtension {
    return {
      manifest: {
        id,
        name: `Extension ${id}`,
        version: "1.0.0",
        description: `Test extension ${id}`,
        capabilities: {
          hasMainProcess: false,
          hasRendererProcess: false,
          hasDatabaseSchema: false,
          hasSettingsSchema: false,
        },
      },
      directory: `/extensions/${id}`,
      registeredChannels: [],
    };
  }

  describe("register", () => {
    it("should register an extension successfully", () => {
      const extension = createMockExtension("test-ext");
      extensionRegistry.register(extension);

      expect(extensionRegistry.has("test-ext")).toBe(true);
      expect(extensionRegistry.get("test-ext")).toBe(extension);
    });

    it("should throw error when registering duplicate extension", () => {
      const extension1 = createMockExtension("duplicate");
      const extension2 = createMockExtension("duplicate");

      extensionRegistry.register(extension1);

      expect(() => extensionRegistry.register(extension2)).toThrow(
        'Extension with id "duplicate" is already registered',
      );
    });
  });

  describe("get", () => {
    it("should return extension when it exists", () => {
      const extension = createMockExtension("existing");
      extensionRegistry.register(extension);

      const result = extensionRegistry.get("existing");
      expect(result).toBe(extension);
    });

    it("should return undefined when extension does not exist", () => {
      const result = extensionRegistry.get("non-existent");
      expect(result).toBeUndefined();
    });
  });

  describe("getAll", () => {
    it("should return empty array when no extensions registered", () => {
      const result = extensionRegistry.getAll();
      expect(result).toEqual([]);
    });

    it("should return all registered extensions", () => {
      const ext1 = createMockExtension("ext1");
      const ext2 = createMockExtension("ext2");
      const ext3 = createMockExtension("ext3");

      extensionRegistry.register(ext1);
      extensionRegistry.register(ext2);
      extensionRegistry.register(ext3);

      const result = extensionRegistry.getAll();
      expect(result).toHaveLength(3);
      expect(result).toContain(ext1);
      expect(result).toContain(ext2);
      expect(result).toContain(ext3);
    });
  });

  describe("has", () => {
    it("should return true when extension exists", () => {
      const extension = createMockExtension("exists");
      extensionRegistry.register(extension);

      expect(extensionRegistry.has("exists")).toBe(true);
    });

    it("should return false when extension does not exist", () => {
      expect(extensionRegistry.has("does-not-exist")).toBe(false);
    });
  });

  describe("unregister", () => {
    it("should unregister extension successfully", () => {
      const extension = createMockExtension("to-remove");
      extensionRegistry.register(extension);

      const result = extensionRegistry.unregister("to-remove");
      expect(result).toBe(true);
      expect(extensionRegistry.has("to-remove")).toBe(false);
    });

    it("should return false when unregistering non-existent extension", () => {
      const result = extensionRegistry.unregister("non-existent");
      expect(result).toBe(false);
    });
  });

  describe("clear", () => {
    it("should clear all extensions", () => {
      extensionRegistry.register(createMockExtension("ext1"));
      extensionRegistry.register(createMockExtension("ext2"));
      extensionRegistry.register(createMockExtension("ext3"));

      extensionRegistry.clear();

      expect(extensionRegistry.getAll()).toHaveLength(0);
      expect(extensionRegistry.has("ext1")).toBe(false);
      expect(extensionRegistry.has("ext2")).toBe(false);
      expect(extensionRegistry.has("ext3")).toBe(false);
    });
  });
});
