import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  SETTING_IDS,
  SETTINGS_SEARCH_INDEX,
} from "./settingsSearchIndex";

describe("SETTINGS_SEARCH_INDEX", () => {
  it("includes the multi-window experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enableMultiWindow,
      ),
    ).toEqual({
      id: SETTING_IDS.enableMultiWindow,
      label: "Enable multiple windows",
      description:
        'Show the experimental "Open in New Window" action in app context menus',
      keywords: [
        "window",
        "multiple",
        "multi-window",
        "app",
        "context menu",
        "experiment",
      ],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });

  it("includes the block unsafe npm packages experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.blockUnsafeNpmPackages,
      ),
    ).toEqual({
      id: SETTING_IDS.blockUnsafeNpmPackages,
      label: "Block unsafe npm packages",
      description: "Uses socket.dev to detect unsafe packages and blocks them",
      keywords: ["socket", "npm", "firewall", "package", "unsafe", "security"],
      sectionId: SECTION_IDS.advanced,
      sectionLabel: "Advanced",
    });
  });

  it("includes the pnpm upgrade warning experiment", () => {
    expect(
      SETTINGS_SEARCH_INDEX.find(
        (item) => item.id === SETTING_IDS.enablePnpmMinimumReleaseAgeWarning,
      ),
    ).toEqual({
      id: SETTING_IDS.enablePnpmMinimumReleaseAgeWarning,
      label: "Enable pnpm upgrade warning",
      description:
        "Show the pnpm release-age warning toast and one-click pnpm upgrade action",
      keywords: [
        "pnpm",
        "npm",
        "package",
        "release",
        "warning",
        "toast",
        "upgrade",
        "experiment",
      ],
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });
});
