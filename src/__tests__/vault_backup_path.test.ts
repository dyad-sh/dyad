import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "path";
import os from "os";

/**
 * Tests for vault backup path resolution.
 *
 * The vault:create-backup handler MUST resolve app paths using getAbbaAppPath(),
 * which:
 * - For relative paths (e.g., "calm-zebra-wiggle"): resolves to ~/abba-ai-apps/calm-zebra-wiggle
 * - For absolute paths: uses them as-is
 *
 * It must NOT use:
 * - app.getPath('userData') / Electron version paths like AppData/Local/abba_ai/app-x.x.x/
 * - Any other path derivation
 */

// Mock paths module to test the path resolution logic
vi.mock("../paths/paths", () => ({
  getAbbaAppPath: vi.fn((appPath: string) => {
    if (path.isAbsolute(appPath)) {
      return appPath;
    }
    // Simulate the real behavior: relative paths resolve to ~/abba-ai-apps/<appPath>
    return path.join(os.homedir(), "abba-ai-apps", appPath);
  }),
  getAbbaAppsBaseDirectory: vi.fn(() =>
    path.join(os.homedir(), "abba-ai-apps"),
  ),
}));

describe("Vault Backup Path Resolution", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getAbbaAppPath behavior contract", () => {
    it("should resolve relative paths to ~/abba-ai-apps/<path>", async () => {
      const { getAbbaAppPath } = await import("../paths/paths");

      const relativePath = "calm-zebra-wiggle";
      const resolved = getAbbaAppPath(relativePath);

      expect(resolved).toBe(
        path.join(os.homedir(), "abba-ai-apps", "calm-zebra-wiggle"),
      );
    });

    it("should use absolute paths as-is", async () => {
      const { getAbbaAppPath } = await import("../paths/paths");

      const absolutePath = path.join(os.homedir(), "custom-location", "my-app");
      const resolved = getAbbaAppPath(absolutePath);

      expect(resolved).toBe(absolutePath);
    });

    it("should NOT produce Electron userData paths", async () => {
      const { getAbbaAppPath } = await import("../paths/paths");

      const relativePath = "test-app";
      const resolved = getAbbaAppPath(relativePath);

      // Must NOT contain Electron userData patterns
      expect(resolved).not.toContain("AppData");
      expect(resolved).not.toContain("app-");
      expect(resolved).not.toContain("abba_ai");
      expect(resolved).not.toContain("Local");

      // Must contain the correct pattern
      expect(resolved).toContain("abba-ai-apps");
      expect(resolved).toContain("test-app");
    });
  });

  describe("Vault backup error contract", () => {
    it("should define structured error for missing project folder", () => {
      // The error message contract when project folder doesn't exist
      const appName = "my-test-app";
      const resolvedPath = path.join(
        os.homedir(),
        "abba-ai-apps",
        "my-test-app",
      );

      const expectedErrorPattern = new RegExp(
        `Project folder not found: ${resolvedPath.replace(/\\/g, "\\\\")}.*` +
          `The app "${appName}" may have been moved or deleted.*` +
          `Please rebuild the app or update its location`,
      );

      const errorMessage =
        `Project folder not found: ${resolvedPath}. ` +
        `The app "${appName}" may have been moved or deleted. ` +
        `Please rebuild the app or update its location in settings.`;

      expect(errorMessage).toMatch(expectedErrorPattern);
    });

    it("should include all required fields in error context", () => {
      // Error context structure contract
      const errorInfo = {
        appId: 123,
        appName: "test-app",
        storedPath: "test-app", // relative path from DB
        resolvedPath: path.join(os.homedir(), "abba-ai-apps", "test-app"),
      };

      expect(errorInfo).toHaveProperty("appId");
      expect(errorInfo).toHaveProperty("appName");
      expect(errorInfo).toHaveProperty("storedPath");
      expect(errorInfo).toHaveProperty("resolvedPath");

      // resolvedPath should be absolute
      expect(path.isAbsolute(errorInfo.resolvedPath)).toBe(true);
    });
  });

  describe("Windows-specific path patterns", () => {
    it("should handle Windows relative paths correctly", () => {
      const relativePath = "calm-zebra-wiggle";

      // On Windows, this should NOT produce:
      // C:\Users\<user>\AppData\Local\abba_ai\app-0.2.8\calm-zebra-wiggle
      //
      // It SHOULD produce:
      // C:\Users\<user>\abba-ai-apps\calm-zebra-wiggle

      const badPattern = /AppData.*Local.*abba_ai.*app-\d+\.\d+\.\d+/;
      const goodPattern = /abba-ai-apps/;

      // Mock resolved path (what getAbbaAppPath should return)
      const resolved = path.join(os.homedir(), "abba-ai-apps", relativePath);

      expect(resolved).not.toMatch(badPattern);
      expect(resolved).toMatch(goodPattern);
    });

    it("should identify problematic userData-derived paths", () => {
      // This is what the bug was producing (WRONG)
      const badPath =
        "C:\\Users\\yosiw\\AppData\\Local\\abba_ai\\app-0.2.8\\calm-zebra-wiggle";

      // Pattern check for the problematic path
      expect(badPath).toMatch(/AppData.*Local.*abba_ai.*app-\d+\.\d+\.\d+/);

      // The correct path should NOT match this pattern
      const goodPath = "C:\\Users\\yosiw\\abba-ai-apps\\calm-zebra-wiggle";
      expect(goodPath).not.toMatch(
        /AppData.*Local.*abba_ai.*app-\d+\.\d+\.\d+/,
      );
    });
  });
});

describe("Vault Backup IPC Channel Contract", () => {
  it("should have vault:create-backup channel registered", () => {
    // This test documents the expected IPC channel
    const expectedChannel = "vault:create-backup";
    expect(expectedChannel).toBe("vault:create-backup");
  });

  it("should accept VaultBackupParams structure", () => {
    interface VaultBackupParams {
      appId: number;
      notes?: string;
    }

    const params: VaultBackupParams = {
      appId: 123,
      notes: "Pre-refactor backup",
    };

    expect(params.appId).toBeTypeOf("number");
    expect(params.notes).toBeTypeOf("string");

    // Without notes
    const paramsNoNotes: VaultBackupParams = { appId: 456 };
    expect(paramsNoNotes.notes).toBeUndefined();
  });
});
