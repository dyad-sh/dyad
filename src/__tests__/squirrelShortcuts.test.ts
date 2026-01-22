import { describe, it, expect } from "vitest";
import {
  detectSquirrelEvent,
  getUpdateExePath,
  getExeName,
  buildShortcutArgs,
  SHORTCUT_LOCATIONS,
} from "../main/squirrelShortcuts";

describe("squirrelShortcuts", () => {
  describe("detectSquirrelEvent", () => {
    it("returns null for empty argv", () => {
      expect(detectSquirrelEvent([])).toBe(null);
    });

    it("returns null when no Squirrel event is present", () => {
      expect(detectSquirrelEvent(["app.exe", "--version"])).toBe(null);
    });

    it("detects --squirrel-install", () => {
      expect(
        detectSquirrelEvent(["app.exe", "--squirrel-install", "1.0.0"]),
      ).toBe("squirrel-install");
    });

    it("detects --squirrel-updated", () => {
      expect(
        detectSquirrelEvent(["app.exe", "--squirrel-updated", "1.0.0"]),
      ).toBe("squirrel-updated");
    });

    it("detects --squirrel-uninstall", () => {
      expect(
        detectSquirrelEvent(["app.exe", "--squirrel-uninstall", "1.0.0"]),
      ).toBe("squirrel-uninstall");
    });

    it("detects --squirrel-obsolete", () => {
      expect(
        detectSquirrelEvent(["app.exe", "--squirrel-obsolete", "1.0.0"]),
      ).toBe("squirrel-obsolete");
    });

    it("ignores partial matches", () => {
      expect(detectSquirrelEvent(["app.exe", "--squirrel"])).toBe(null);
      expect(detectSquirrelEvent(["app.exe", "squirrel-install"])).toBe(null);
    });
  });

  describe("getUpdateExePath", () => {
    it("returns Update.exe path two directories up from execPath (Windows)", () => {
      const execPath =
        "C:\\Users\\test\\AppData\\Local\\abba_ai\\app-1.0.0\\ABBA AI.exe";
      const expected = "C:\\Users\\test\\AppData\\Local\\abba_ai\\Update.exe";
      expect(getUpdateExePath(execPath)).toBe(expected);
    });

    it("handles paths with version numbers", () => {
      const execPath =
        "C:\\Users\\test\\AppData\\Local\\abba_ai\\app-0.1.10\\ABBA AI.exe";
      const expected = "C:\\Users\\test\\AppData\\Local\\abba_ai\\Update.exe";
      expect(getUpdateExePath(execPath)).toBe(expected);
    });
  });

  describe("getExeName", () => {
    it("extracts exe name from full path", () => {
      expect(
        getExeName(
          "C:\\Users\\test\\AppData\\Local\\abba_ai\\app-1.0.0\\ABBA AI.exe",
        ),
      ).toBe("ABBA AI.exe");
    });

    it("handles spaces in filename", () => {
      expect(getExeName("C:\\path\\to\\My App Name.exe")).toBe(
        "My App Name.exe",
      );
    });
  });

  describe("buildShortcutArgs", () => {
    it("builds createShortcut args with all locations", () => {
      const args = buildShortcutArgs("ABBA AI.exe", "createShortcut");
      expect(args).toEqual([
        "--createShortcut",
        "ABBA AI.exe",
        "--shortcut-locations=Desktop,StartMenu",
      ]);
    });

    it("builds removeShortcut args with all locations", () => {
      const args = buildShortcutArgs("ABBA AI.exe", "removeShortcut");
      expect(args).toEqual([
        "--removeShortcut",
        "ABBA AI.exe",
        "--shortcut-locations=Desktop,StartMenu",
      ]);
    });
  });

  describe("SHORTCUT_LOCATIONS", () => {
    it("includes Desktop and StartMenu", () => {
      expect(SHORTCUT_LOCATIONS).toContain("Desktop");
      expect(SHORTCUT_LOCATIONS).toContain("StartMenu");
    });
  });
});
