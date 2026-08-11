import { describe, expect, it } from "vitest";

import {
  SYSTEM_DESTINATIONS,
  SYSTEM_GROUPS,
  destinationsInGroup,
  findDestination,
} from "@/lib/system_sections";
import { SETTINGS_TABS } from "@/lib/settingsTabs";

/**
 * The refactor's contract: reorganisation with zero feature loss.
 *
 * Moving eleven destinations behind one entry is exactly the kind of change
 * that silently strands something. These tests assert what must remain true
 * regardless of how the section is grouped or styled.
 */

/** The canonical destinations, from the brief. */
const REQUIRED = [
  "infrastructure",
  "data-sources",
  "storage",
  "ai-providers",
  "model-roles",
  "mcp",
  "plugins",
  "integrations",
  "skills",
  "security",
  "appearance",
  "advanced",
  "voice-assistant",
];

describe("System destinations", () => {
  it("contains exactly the canonical set", () => {
    expect(SYSTEM_DESTINATIONS.map((d) => d.id).sort()).toEqual(
      [...REQUIRED].sort(),
    );
  });

  it("gives every destination a group that is rendered", () => {
    // A destination in a group the page never renders is unreachable.
    for (const destination of SYSTEM_DESTINATIONS) {
      expect(SYSTEM_GROUPS, destination.id).toContain(destination.group);
    }
  });

  it("renders every group somewhere", () => {
    for (const group of SYSTEM_GROUPS) {
      expect(destinationsInGroup(group).length, group).toBeGreaterThan(0);
    }
  });

  it("points every settings-backed destination at a real tab", () => {
    // The failure this catches: a renamed tab id leaving a blank panel.
    const tabIds = new Set(SETTINGS_TABS.map((tab) => tab.id));
    for (const destination of SYSTEM_DESTINATIONS) {
      if (destination.renders.kind !== "settings-tab") continue;
      expect(
        tabIds.has(destination.renders.tab),
        `${destination.id} points at unknown tab "${destination.renders.tab}"`,
      ).toBe(true);
    }
  });

  it("covers every settings tab, so none is stranded", () => {
    // Every tab that existed must be reachable through System. A tab nobody
    // routes to is a feature nobody can find.
    const routed = new Set(
      SYSTEM_DESTINATIONS.filter((d) => d.renders.kind === "settings-tab").map(
        (d) => (d.renders as { tab: string }).tab,
      ),
    );

    // No exceptions. /settings renders System now, so a tab System does not
    // route to is a tab with no way in at all.
    const stranded = SETTINGS_TABS.map((tab) => tab.id).filter(
      (id) => !routed.has(id),
    );
    expect(stranded, "settings tabs not reachable from System").toEqual([]);
  });

  it("claims no tab twice", () => {
    const tabs = SYSTEM_DESTINATIONS.filter(
      (d) => d.renders.kind === "settings-tab",
    ).map((d) => (d.renders as { tab: string }).tab);
    expect(new Set(tabs).size).toBe(tabs.length);
  });

  it("gives every destination a distinct one-line summary", () => {
    // The categories are only useful if they are distinguishable.
    const summaries = SYSTEM_DESTINATIONS.map((d) => d.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
    for (const summary of summaries) {
      expect(summary.length).toBeGreaterThan(0);
    }
  });

  it("resolves a destination by id and rejects an unknown one", () => {
    expect(findDestination("mcp")?.label).toBe("MCP");
    expect(findDestination("nonsense")).toBeUndefined();
    expect(findDestination(null)).toBeUndefined();
  });

  it("keeps the legacy route recorded for anything that moved", () => {
    // Old links must keep working; recording the route is how we remember.
    for (const id of ["infrastructure", "data-sources", "storage"]) {
      expect(findDestination(id)?.legacyRoute, id).toBeTruthy();
    }
  });
});
