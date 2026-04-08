import { describe, expect, it } from "vitest";
import {
  SECTION_IDS,
  SETTING_IDS,
  SETTINGS_SEARCH_INDEX,
} from "./settingsSearchIndex";

describe("SETTINGS_SEARCH_INDEX", () => {
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
      sectionId: SECTION_IDS.experiments,
      sectionLabel: "Experiments",
    });
  });
});
