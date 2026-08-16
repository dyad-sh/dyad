import { describe, expect, it } from "vitest";
import { SECTION_IDS } from "./settingsSearchIndex";
import { getTabIdForSection, SETTINGS_TABS } from "./settingsTabs";

describe("settingsTabs", () => {
  it("maps every known section to a tab", () => {
    for (const sectionId of Object.values(SECTION_IDS)) {
      expect(getTabIdForSection(sectionId)).toBeTruthy();
    }
  });

  it("places providers under the AI tab", () => {
    expect(getTabIdForSection(SECTION_IDS.providers)).toBe("ai");
  });

  it("consolidates service connections into the extensions hub", () => {
    expect(getTabIdForSection(SECTION_IDS.integrations)).toBe("plugins");
    expect(getTabIdForSection(SECTION_IDS.connections)).toBe("plugins");
    expect(SETTINGS_TABS.map((tab) => tab.id)).not.toContain("connections");
    expect(SETTINGS_TABS.map((tab) => tab.id)).not.toContain("integrations");
  });

  it("places developer service configuration under Plugins", () => {
    expect(getTabIdForSection(SECTION_IDS.plugins)).toBe("plugins");
    expect(getTabIdForSection(SECTION_IDS.systemAccess)).toBe("plugins");
    expect(SETTINGS_TABS.find((tab) => tab.id === "plugins")).toMatchObject({
      label: "Plugins",
      description: "Plugins, skills and integrations",
    });
    expect(SETTINGS_TABS.map((tab) => tab.id)).not.toContain("skills");
  });

  it("labels the AI tab as Providers", () => {
    expect(SETTINGS_TABS.find((tab) => tab.id === "ai")).toMatchObject({
      label: "Providers",
      description: "Provider connections and models",
    });
  });

  it("places danger zone under System", () => {
    expect(getTabIdForSection(SECTION_IDS.dangerZone)).toBe("general");
  });

  it("labels Appearance as the final settings tab", () => {
    // Called System until System became the section that contains it, which
    // would have read as System > System.
    expect(SETTINGS_TABS.at(-1)).toMatchObject({
      id: "general",
      label: "Appearance",
      description: "Appearance, language and app info",
    });
  });

  it("places agent model settings under the unified Model Roles tab", () => {
    expect(getTabIdForSection(SECTION_IDS.modelRoles)).toBe("modelRoles");
    expect(getTabIdForSection(SECTION_IDS.chatAgent)).toBe("modelRoles");
    expect(getTabIdForSection(SECTION_IDS.imageAgent)).toBe("modelRoles");
    expect(getTabIdForSection(SECTION_IDS.videoAgent)).toBe("modelRoles");
  });

  it("does not expose separate chat, image, or video model tabs", () => {
    const ids = SETTINGS_TABS.map((tab) => tab.id);
    expect(ids).not.toContain("chatAgent");
    expect(ids).not.toContain("imageAgent");
    expect(ids).not.toContain("videoAgent");
  });

  it("places MCP server settings under the MCP tab", () => {
    expect(getTabIdForSection(SECTION_IDS.toolsMcp)).toBe("mcp");
    expect(getTabIdForSection(SECTION_IDS.storage)).toBe("storage");
  });

  it("covers each section exactly once across tabs", () => {
    const covered = SETTINGS_TABS.flatMap((tab) => tab.sectionIds);
    expect(new Set(covered).size).toBe(covered.length);
    expect(covered).toHaveLength(Object.values(SECTION_IDS).length);
  });
});
