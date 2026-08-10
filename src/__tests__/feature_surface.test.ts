import { describe, expect, it } from "vitest";

import { SETTINGS_TABS } from "@/lib/settingsTabs";
import { SECTION_IDS } from "@/lib/settingsSearchIndex";
import { DESKTOP_APPS } from "@/lib/desktop/desktop_apps";
import { isChatOwnedPath, screenForPath } from "@/lib/workspace_screens";

/**
 * The feature surface, locked.
 *
 * Reorganising navigation is meant to move where things sit, never to remove
 * them. That intent is easy to hold and easy to break: a settings section can
 * be dropped from a tab's list during a merge and nothing else complains,
 * because an orphaned section still compiles, still renders, and simply
 * becomes unreachable.
 *
 * So the surface is asserted rather than assumed. These tests do not care how
 * things are grouped. They care that everything is still reachable through
 * something, which is the property a reorganisation must preserve.
 */

describe("settings sections", () => {
  const assigned = new Set<string>(
    SETTINGS_TABS.flatMap((tab) => tab.sectionIds),
  );

  it("every declared section is reachable from some tab", () => {
    // The failure this catches: a section quietly orphaned during a merge.
    const orphaned = Object.entries(SECTION_IDS)
      .map(([key, id]) => ({ key, id }))
      .filter((section) => !assigned.has(section.id));

    expect(
      orphaned.map((section) => section.key),
      "these settings sections are not reachable from any tab",
    ).toEqual([]);
  });

  it("every tab points at sections that exist", () => {
    const known = new Set<string>(Object.values(SECTION_IDS));
    for (const tab of SETTINGS_TABS) {
      for (const sectionId of tab.sectionIds) {
        expect(
          known.has(sectionId),
          `tab "${tab.label}" references unknown section "${sectionId}"`,
        ).toBe(true);
      }
    }
  });

  it("every tab has a label and at least one section", () => {
    for (const tab of SETTINGS_TABS) {
      expect(tab.label.length, `tab "${tab.id}" has no label`).toBeGreaterThan(
        0,
      );
      expect(
        tab.sectionIds.length,
        `tab "${tab.label}" would render nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("no section is claimed by two tabs", () => {
    // Duplication is how a section ends up edited in one place and read from
    // another.
    const seen = new Map<string, string>();
    for (const tab of SETTINGS_TABS) {
      for (const sectionId of tab.sectionIds) {
        const owner = seen.get(sectionId);
        expect(
          owner,
          `section "${sectionId}" is in both "${owner}" and "${tab.label}"`,
        ).toBeUndefined();
        seen.set(sectionId, tab.label);
      }
    }
  });
});

describe("desktop apps", () => {
  it("every app still resolves a component", () => {
    for (const app of DESKTOP_APPS) {
      expect(typeof app.component, `app "${app.title}" has no component`).toBe(
        "function",
      );
    }
  });

  it("every app declares at least one route path", () => {
    for (const app of DESKTOP_APPS) {
      expect(
        app.routePaths.length,
        `app "${app.title}" is unreachable by route`,
      ).toBeGreaterThan(0);
    }
  });

  /**
   * Old paths kept alive so existing links do not break.
   *
   * They resolve to a route but have no screen of their own, so they open an
   * untitled tab. Pre-existing, and listed here rather than asserted away so
   * the gap stays visible instead of being forgotten.
   */
  const LEGACY_ALIASES = new Set(["/social-media-agent"]);

  it("every app route opens a known workspace screen", () => {
    // A route with no screen opens a blank tab, which is the failure mode
    // that already bit the Engineering page once.
    for (const app of DESKTOP_APPS) {
      for (const routePath of app.routePaths) {
        // Chats own their tabs per conversation, so those routes deliberately
        // have no screen entry. Asserting otherwise would be asserting the
        // opposite of the design.
        if (isChatOwnedPath(routePath)) continue;
        if (LEGACY_ALIASES.has(routePath)) continue;
        expect(
          screenForPath(routePath),
          `route "${routePath}" (${app.title}) has no workspace screen`,
        ).toBeDefined();
      }
    }
  });

  it("has no duplicate app ids", () => {
    const ids = DESKTOP_APPS.map((app) => app.id);
    expect(new Set(ids).size, "duplicate desktop app id").toBe(ids.length);
  });
});
