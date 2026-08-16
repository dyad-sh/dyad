import { describe, expect, it } from "vitest";

import {
  migrateLegacyTheme,
  migrateStoredTheme,
  resolveThemeChoice,
  UI_THEMES,
} from "@/lib/ui_themes";

describe("resolveThemeChoice", () => {
  it("maps each theme to its base palette", () => {
    expect(resolveThemeChoice("holographic", false)).toEqual({
      base: "dark",
      uiTheme: "holographic",
    });
    expect(resolveThemeChoice("dark", false)).toEqual({
      base: "dark",
      uiTheme: "dark",
    });
    expect(resolveThemeChoice("macos", true)).toEqual({
      base: "light",
      uiTheme: "macos",
    });
    expect(resolveThemeChoice("light", true)).toEqual({
      base: "light",
      uiTheme: "light",
    });
  });

  it("system follows the OS between Light and Dark only", () => {
    expect(resolveThemeChoice("system", true).uiTheme).toBe("dark");
    expect(resolveThemeChoice("system", false).uiTheme).toBe("light");
    // Never resolves to a branded theme the user did not pick.
    expect(resolveThemeChoice("system", true).uiTheme).not.toBe("holographic");
  });
});

describe("stored theme migration", () => {
  it("keeps valid new values", () => {
    expect(migrateStoredTheme("macos")).toBe("macos");
    expect(migrateStoredTheme("system")).toBe("system");
  });

  it("defaults unknown values to the flagship theme", () => {
    expect(migrateStoredTheme(null)).toBe("holographic");
    expect(migrateStoredTheme("banana")).toBe("holographic");
  });

  it("upgrades the legacy selector preserving what the user saw", () => {
    // Old "dark" WAS holographic; old "system" showed it on dark-mode Macs.
    expect(migrateLegacyTheme("dark")).toBe("holographic");
    expect(migrateLegacyTheme("system")).toBe("holographic");
    expect(migrateLegacyTheme("light")).toBe("light");
    expect(migrateLegacyTheme(null)).toBeNull();
  });
});

describe("theme catalogue", () => {
  it("offers exactly the four themes, holographic first", () => {
    expect(UI_THEMES.map((theme) => theme.id)).toEqual([
      "holographic",
      "macos",
      "dark",
      "light",
    ]);
  });

  it("gives every theme a complete preview palette", () => {
    for (const theme of UI_THEMES) {
      for (const value of Object.values(theme.preview)) {
        expect(value.length).toBeGreaterThan(3);
      }
    }
  });

  it("presents the Apple-inspired option as a native macOS theme", () => {
    expect(UI_THEMES.find((theme) => theme.id === "macos")?.label).toBe(
      "macOS Native",
    );
  });
});
